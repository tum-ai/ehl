import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug 3: finalizing jury votes must NEVER be a silent no-op. An unscored
// (community) challenge is finalized but produces no league scores; the action
// must report that (isScored:false, scoresWritten:0) so the UI can say so. And a
// challenge finalized while unscored, then corrected to Scored, must be
// recoverable via regenerateScoresFromFinalizedRankings (finalize refuses to run
// twice). We assert both.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  logEventStrict: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEvent: mocks.logEvent,
  logEventStrict: mocks.logEventStrict,
}));
vi.mock("@/lib/jury-validation", () => ({ validateJuryRanking: vi.fn(() => null) }));

import {
  finalizeJuryVotes,
  regenerateScoresFromFinalizedRankings,
} from "@/lib/actions/jury";

const CH = "challenge-1";
const CHAPTER = "chapter-1";

interface CallState {
  table: string;
  op: string;
  filters: [string, unknown][];
  payload: unknown;
}

function makeAdminClient(opts: {
  responder: (s: CallState) => unknown;
  calls: CallState[];
}) {
  function makeBuilder() {
    const state: CallState = { table: "", op: "select", filters: [], payload: null };
    const resolve = () => {
      opts.calls.push({ ...state, filters: [...state.filters] });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
      upsert: (p: unknown) => ((state.op = "upsert"), (state.payload = p), builder),
      delete: () => ((state.op = "delete"), builder),
      eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      in: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      order: () => builder,
      limit: () => builder,
      single: () => resolve(),
      maybeSingle: () => resolve(),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        resolve().then(onF, onR),
    };
    return { builder, state };
  }
  return {
    from(table: string) {
      const { builder, state } = makeBuilder();
      state.table = table;
      return builder;
    },
  };
}

function upsertPayload(calls: CallState[]): unknown[] {
  const u = calls.find((c) => c.table === "scores" && c.op === "upsert");
  return (u?.payload as unknown[]) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
  mocks.logEventStrict.mockResolvedValue(undefined);
});

describe("finalizeJuryVotes — honest about scores", () => {
  it("UNSCORED challenge: finalizes but writes NO scores and reports it", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "jury_rankings" && op === "select")
            return { data: [{ ranking: { "1": "t1" } }] };
          if (table === "challenges" && op === "select")
            return {
              data: {
                chapter_id: CHAPTER,
                title: "Community",
                is_scored: false,
                jury_finalized_at: null,
              },
            };
          return { data: null, error: null };
        },
      })
    );

    const result = await finalizeJuryVotes(CH);
    expect(result).toMatchObject({ success: true, isScored: false, scoresWritten: 0 });
    // No scores upsert happened.
    expect(calls.find((c) => c.table === "scores" && c.op === "upsert")).toBeUndefined();
  });

  it("SCORED challenge: writes placement + participation scores and reports the count", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "jury_rankings" && op === "select")
            return { data: [{ ranking: { "1": "t1", "2": "t2" } }] };
          if (table === "challenges" && op === "select")
            return {
              data: {
                chapter_id: CHAPTER,
                title: "Scored",
                is_scored: true,
                jury_finalized_at: null,
              },
            };
          if (table === "submissions" && op === "select")
            return { data: [{ team_id: "t1" }, { team_id: "t2" }, { team_id: "t3" }] };
          if (table === "scores" && op === "select") return { data: [] }; // no overrides
          if (table === "scores" && op === "upsert") return { error: null };
          return { data: null, error: null };
        },
      })
    );

    const result = await finalizeJuryVotes(CH);
    expect(result).toMatchObject({ success: true, isScored: true });
    const rows = upsertPayload(calls) as Array<{ team_id: string; placement: number | null }>;
    // t1=1st, t2=2nd, t3=participation
    expect(rows.find((r) => r.team_id === "t1")?.placement).toBe(1);
    expect(rows.find((r) => r.team_id === "t2")?.placement).toBe(2);
    expect(rows.find((r) => r.team_id === "t3")?.placement).toBeNull();
    expect((result as { scoresWritten: number }).scoresWritten).toBe(3);
  });

  it("refuses to finalize a challenge that is already finalized", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "jury_rankings" && op === "select")
            return { data: [{ ranking: { "1": "t1" } }] };
          if (table === "challenges" && op === "select")
            return {
              data: {
                chapter_id: CHAPTER,
                title: "X",
                is_scored: true,
                jury_finalized_at: "2026-06-26T00:00:00Z",
              },
            };
          return { data: null, error: null };
        },
      })
    );
    const result = await finalizeJuryVotes(CH);
    expect(result.error).toMatch(/already.*finalized/i);
  });
});

describe("regenerateScoresFromFinalizedRankings — recovery path", () => {
  it("generates scores for a finalized, now-Scored challenge with none yet", async () => {
    const calls: CallState[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op, filters }) => {
          if (table === "challenges" && op === "select")
            return {
              data: {
                chapter_id: CHAPTER,
                title: "Recovered",
                is_scored: true,
                jury_finalized_at: "2026-06-26T00:00:00Z",
              },
            };
          // First scores select = existing jury rows (must be empty to proceed);
          // second scores select (inside writer) = admin overrides (empty).
          if (table === "scores" && op === "select") return { data: [] };
          if (table === "scores" && op === "upsert") return { error: null };
          if (table === "jury_rankings" && op === "select")
            return { data: [{ ranking: { "1": "t1" } }] };
          if (table === "submissions" && op === "select")
            return { data: [{ team_id: "t1" }] };
          return { data: null, error: null };
        },
      })
    );

    const result = await regenerateScoresFromFinalizedRankings(CH);
    expect(result).toMatchObject({ success: true });
    expect((result as { scoresWritten: number }).scoresWritten).toBe(1);
  });

  it("refuses when the challenge is not Scored", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "challenges" && op === "select")
            return {
              data: { chapter_id: CHAPTER, title: "C", is_scored: false, jury_finalized_at: "x" },
            };
          return { data: null, error: null };
        },
      })
    );
    const result = await regenerateScoresFromFinalizedRankings(CH);
    expect(result.error).toMatch(/not marked as scored/i);
  });

  it("refuses when scores already exist (won't clobber)", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "challenges" && op === "select")
            return {
              data: { chapter_id: CHAPTER, title: "C", is_scored: true, jury_finalized_at: "x" },
            };
          if (table === "scores" && op === "select")
            return { data: [{ team_id: "t1" }] };
          return { data: null, error: null };
        },
      })
    );
    const result = await regenerateScoresFromFinalizedRankings(CH);
    expect(result.error).toMatch(/already exist/i);
  });

  it("refuses when the challenge has not been finalized", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        responder: ({ table, op }) => {
          if (table === "challenges" && op === "select")
            return {
              data: { chapter_id: CHAPTER, title: "C", is_scored: true, jury_finalized_at: null },
            };
          return { data: null, error: null };
        },
      })
    );
    const result = await regenerateScoresFromFinalizedRankings(CH);
    expect(result.error).toMatch(/not been finalized/i);
  });
});
