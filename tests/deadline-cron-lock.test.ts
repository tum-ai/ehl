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
  for (const m of ["select", "eq", "not", "lte", "lt", "delete", "update", "upsert"]) {
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
