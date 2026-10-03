import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runWithWorkerLease,
  WORKER_LEASE_SECONDS,
  WORKER_LEASE_RENEW_MS,
  DISPATCH_LOCK_SECONDS,
} from "@/lib/submission-snapshots/lease";
import { dispatchPendingSnapshots } from "@/lib/submission-snapshots/dispatch";

// Jurors need access while pitching starts, so a crashed worker must not hold
// the copy queue for long. The rehearsal showed the old 30-minute lock doing that.

function fakeDb(acquired = true) {
  const renewals: Array<Record<string, unknown>> = [];
  const update = vi.fn((values: Record<string, unknown>) => {
    renewals.push(values);
    const chain = { eq: () => chain, not: () => chain, then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
    return chain;
  });
  const rpc = vi.fn(async (name: string) => ({ data: name === "try_acquire_cron_lock" ? acquired : null, error: null }));
  const db = { rpc, from: vi.fn(() => ({ update })) } as unknown as SupabaseClient;
  return { db, rpc, renewals };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("takes a short lease, so a crashed worker frees the queue within 90 seconds", async () => {
  expect(WORKER_LEASE_SECONDS).toBeLessThanOrEqual(90);
  const { db, rpc } = fakeDb();
  await runWithWorkerLease(db, async () => {});
  expect(rpc).toHaveBeenCalledWith("try_acquire_cron_lock", { lock_key: "snapshot:worker", ttl_seconds: WORKER_LEASE_SECONDS });
});

it("renews the lease while a long run is alive", async () => {
  expect(WORKER_LEASE_RENEW_MS).toBeLessThan(WORKER_LEASE_SECONDS * 1000 / 2);
  const { db, renewals } = fakeDb();
  let finish!: () => void;
  const running = runWithWorkerLease(db, () => new Promise<void>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(WORKER_LEASE_RENEW_MS * 3 + 1);
  expect(renewals).toHaveLength(3);
  const expires = Date.parse(String(renewals[2].expires_at));
  expect(expires - Date.now()).toBeGreaterThan(WORKER_LEASE_SECONDS * 1000 - 1000);
  finish();
  await running;
  await vi.advanceTimersByTimeAsync(WORKER_LEASE_RENEW_MS * 3);
  expect(renewals).toHaveLength(3);
});

it("releases the lease after a normal run and after a failure", async () => {
  const ok = fakeDb();
  await runWithWorkerLease(ok.db, async () => {});
  expect(ok.rpc).toHaveBeenCalledWith("release_cron_lock", { lock_key: "snapshot:worker" });
  const failing = fakeDb();
  await expect(runWithWorkerLease(failing.db, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(failing.rpc).toHaveBeenCalledWith("release_cron_lock", { lock_key: "snapshot:worker" });
});

it("does not run or release when another live worker holds the lease", async () => {
  const { db, rpc } = fakeDb(false);
  const work = vi.fn(async () => {});
  await expect(runWithWorkerLease(db, work)).resolves.toBe(false);
  expect(work).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalledWith("release_cron_lock", expect.anything());
});

it("can dispatch a replacement worker within 90 seconds", async () => {
  expect(DISPATCH_LOCK_SECONDS).toBeLessThanOrEqual(90);
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubEnv("GITHUB_REPO", "owner/repo");
  const queue = { select: () => ({ or: async () => ({ count: 1, error: null }) }) };
  const idle: Record<string, unknown> = {};
  for (const key of ["select", "eq", "gt"]) idle[key] = () => idle;
  idle.maybeSingle = async () => ({ data: null, error: null });
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const db = { from: (table: string) => table === "submission_snapshot_jobs" ? queue : idle, rpc };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  await dispatchPendingSnapshots(db as unknown as SupabaseClient);
  expect(rpc).toHaveBeenCalledWith("try_acquire_cron_lock", { lock_key: "snapshot:dispatch", ttl_seconds: DISPATCH_LOCK_SECONDS });
});

it("the worker script uses the renewed short lease instead of a long fixed lock", () => {
  const script = readFileSync("scripts/process-submission-snapshots.ts", "utf8");
  expect(script).toContain("runWithWorkerLease");
  expect(script).not.toMatch(/ttl_seconds:\s*1800/);
});
