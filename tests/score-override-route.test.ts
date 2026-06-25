import { describe, it, expect, vi, beforeEach } from "vitest";

// The admin score-override route writes each override to the `scores` table and
// then records a strict audit event. These tests pin the invariant surfaced by
// dual review: a score override is logged (and reported as success) ONLY after a
// confirmed DB write. If the upsert fails, the route must NOT log an audit event
// for a mutation that never persisted, and must surface the failure (500).
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createAdminClient: vi.fn(),
  logEventStrict: vi.fn(),
}));

vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/event-log", () => ({ logEventStrict: mocks.logEventStrict }));

import { POST } from "@/app/api/admin/scores/override/route";

const ADMIN_ID = "admin-42";

// Mock admin client whose scores.upsert() returns the configured error (default none).
function makeAdminClient(opts: { upsertError?: { message: string }; upsertCalls: number[] }) {
  let call = 0;
  return {
    from: (_table: string) => ({
      upsert: (_payload: unknown, _opts: unknown) => {
        const idx = call++;
        opts.upsertCalls.push(idx);
        return Promise.resolve({
          // Fail on the FIRST upsert when an error is configured, to prove the
          // loop aborts before logging and before any further write.
          error: opts.upsertError && idx === 0 ? opts.upsertError : null,
        });
      },
    }),
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/scores/override", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({
    user: { id: ADMIN_ID },
    profile: { role: "admin" },
  });
  mocks.logEventStrict.mockResolvedValue(undefined);
});

describe("POST /api/admin/scores/override", () => {
  it("rejects a non-admin session with 403 before any write", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1" }, profile: { role: "participant" } });
    const upsertCalls: number[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ upsertCalls }));

    const res = await POST(
      makeRequest({ chapterId: "c1", overrides: [{ teamId: "t1", placement: 1, points: 8 }] })
    );

    expect(res.status).toBe(403);
    expect(upsertCalls).toEqual([]);
    expect(mocks.logEventStrict).not.toHaveBeenCalled();
  });

  it("writes the override then logs a strict audit event with the admin actor", async () => {
    const upsertCalls: number[] = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ upsertCalls }));

    const res = await POST(
      makeRequest({ chapterId: "c1", overrides: [{ teamId: "t1", placement: 2, points: 7 }] })
    );

    expect(res.status).toBe(200);
    expect(upsertCalls).toEqual([0]);
    expect(mocks.logEventStrict).toHaveBeenCalledTimes(1);
    expect(mocks.logEventStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "score.overridden",
        actorId: ADMIN_ID,
        actorType: "admin",
      })
    );
  });

  it("does NOT log an audit event when the upsert fails, and returns 500", async () => {
    const upsertCalls: number[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ upsertError: { message: "db down" }, upsertCalls })
    );

    const res = await POST(
      makeRequest({ chapterId: "c1", overrides: [{ teamId: "t1", placement: 1, points: 8 }] })
    );

    expect(res.status).toBe(500);
    // The failed mutation must not produce an audit row.
    expect(mocks.logEventStrict).not.toHaveBeenCalled();
  });

  it("aborts the loop on a failed write so later overrides are neither written nor logged", async () => {
    const upsertCalls: number[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ upsertError: { message: "db down" }, upsertCalls })
    );

    const res = await POST(
      makeRequest({
        chapterId: "c1",
        overrides: [
          { teamId: "t1", placement: 1, points: 8 },
          { teamId: "t2", placement: 2, points: 7 },
        ],
      })
    );

    expect(res.status).toBe(500);
    // Only the first upsert ran; the loop aborted before the second.
    expect(upsertCalls).toEqual([0]);
    expect(mocks.logEventStrict).not.toHaveBeenCalled();
  });
});
