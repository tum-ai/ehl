import { describe, it, expect, vi, beforeEach } from "vitest";

// The deadline-check route must serialize runs: if a prior minute's run still
// holds the lock, this invocation exits as a no-op WITHOUT touching the DB, and
// it must not release a lock it never acquired. When it does acquire the lock,
// it must release it even if the run throws. These tests pin that wrapper logic.
const mocks = vi.hoisted(() => ({
  tryAcquireCronLock: vi.fn(),
  releaseCronLock: vi.fn(),
  createAdminClient: vi.fn(),
  lockSubmissionsCore: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/cron-lock", () => ({
  tryAcquireCronLock: mocks.tryAcquireCronLock,
  releaseCronLock: mocks.releaseCronLock,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/submissions-lock", () => ({ lockSubmissionsCore: mocks.lockSubmissionsCore }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));

import { GET } from "@/app/api/cron/deadline-check/route";

const SECRET = "test-cron-secret";

// Minimal admin client: every table/op returns an empty result so runDeadlineCheck
// finds no chapters to advance and completes cleanly.
function emptyAdminClient() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "lte", "lt", "delete", "update", "upsert"]) {
    builder[m] = () => builder;
  }
  // terminal awaits resolve to an empty set
  (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    onF({ data: [], error: null });
  return { from: () => builder };
}

function req(secret?: string) {
  return new Request("https://x/api/cron/deadline-check", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mocks.createAdminClient.mockReturnValue(emptyAdminClient());
});

// A stateful chapters mock that records every status UPDATE so we can assert
// which target each deadline branch advances to. Reads return one row per
// requested source status; the source status is threaded through the row id
// ("<status>::1") so the follow-up .update().eq("id", ...) can recover it.
function transitionRecordingAdminClient(captured: { from: string; to: string }[]) {
  function chaptersBuilder() {
    const sourceStatuses: string[] = [];
    let updateTo: string | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.not = () => b;
    b.lte = () => b;
    b.lt = () => b;
    b.delete = () => b;
    b.upsert = () => b;
    b.eq = (col: string, val: string) => {
      if (col === "status") sourceStatuses.push(val);
      if (col === "id" && updateTo) {
        captured.push({ from: val.split("::")[0], to: updateTo });
      }
      return b;
    };
    b.in = (col: string, vals: string[]) => {
      if (col === "status") sourceStatuses.push(...vals);
      return b;
    };
    b.update = (patch: { status?: string }) => {
      if (patch?.status) updateTo = patch.status;
      return b;
    };
    (b as { then: unknown }).then = (onF: (v: unknown) => unknown) => {
      if (updateTo) return onF({ data: null, error: null });
      // One chapter row per source status filtered on this read.
      return onF({
        data: sourceStatuses.map((s) => ({ id: `${s}::1`, name: s, status: s })),
        error: null,
      });
    };
    return b;
  }

  const emptyBuilder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "lte", "lt", "delete", "update", "upsert"]) {
    emptyBuilder[m] = () => emptyBuilder;
  }
  (emptyBuilder as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
    onF({ data: [], error: null });

  return {
    from: (table: string) => (table === "chapters" ? chaptersBuilder() : emptyBuilder),
  };
}

describe("GET /api/cron/deadline-check — transition map", () => {
  beforeEach(() => mocks.tryAcquireCronLock.mockResolvedValue(true));

  it("advances each chapter to the correct next status for its deadline", async () => {
    const captured: { from: string; to: string }[] = [];
    mocks.createAdminClient.mockReturnValue(transitionRecordingAdminClient(captured));

    await GET(req(SECRET));

    // application deadline: applications_open -> preparation
    expect(captured).toContainEqual({ from: "applications_open", to: "preparation" });
    // selection deadline: BOTH challenge_selection AND hacking -> submissions_open.
    // hacking must be covered: an admin may have manually advanced the chapter
    // there, and before this fix the cron left it stranded.
    expect(captured).toContainEqual({ from: "challenge_selection", to: "submissions_open" });
    expect(captured).toContainEqual({ from: "hacking", to: "submissions_open" });
    // submission deadline: submissions_open -> pitching
    expect(captured).toContainEqual({ from: "submissions_open", to: "pitching" });
  });
});

describe("GET /api/cron/deadline-check — lock serialization", () => {
  it("401s before touching the lock when the secret is wrong", async () => {
    const res = await GET(req("wrong"));
    expect(res.status).toBe(401);
    expect(mocks.tryAcquireCronLock).not.toHaveBeenCalled();
  });

  it("skips as a no-op when the lock is already held, without releasing it", async () => {
    mocks.tryAcquireCronLock.mockResolvedValue(false);
    const res = await GET(req(SECRET));
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: "locked" });
    // Must NOT release a lock it never acquired, and must NOT do any DB work.
    expect(mocks.releaseCronLock).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("runs and releases the lock when acquired", async () => {
    mocks.tryAcquireCronLock.mockResolvedValue(true);
    const res = await GET(req(SECRET));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBeUndefined();
    expect(mocks.releaseCronLock).toHaveBeenCalledTimes(1);
  });
});
