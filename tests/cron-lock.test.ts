import { describe, it, expect, vi, beforeEach } from "vitest";

// The deadline cron runs every minute and its submissions->pitching branch can
// run long, so runs are serialized with an atomic DB lock (migration 00048).
// These tests pin the contract the route relies on: acquire returns true only
// when the RPC confirms it, and FAILS CLOSED (false) on any error so a run that
// can't prove it holds the lock never executes.
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { tryAcquireCronLock, releaseCronLock } from "@/lib/cron-lock";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
});

describe("tryAcquireCronLock", () => {
  it("returns true when the RPC confirms the lock was acquired", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await tryAcquireCronLock("k", 600)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("try_acquire_cron_lock", {
      lock_key: "k",
      ttl_seconds: 600,
    });
  });

  it("returns false when the lock is already held (RPC returns false)", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await tryAcquireCronLock("k", 600)).toBe(false);
  });

  it("fails CLOSED on RPC error (never runs without a confirmed lock)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await tryAcquireCronLock("k", 600)).toBe(false);
  });

  it("treats a non-true data value as not acquired", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await tryAcquireCronLock("k", 600)).toBe(false);
  });
});

describe("releaseCronLock", () => {
  it("calls the release RPC with the key", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await releaseCronLock("k");
    expect(mocks.rpc).toHaveBeenCalledWith("release_cron_lock", { lock_key: "k" });
  });

  it("does not throw if release fails (TTL will expire the lock anyway)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(releaseCronLock("k")).resolves.toBeUndefined();
  });
});
