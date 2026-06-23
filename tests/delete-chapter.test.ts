import { describe, it, expect, vi, beforeEach } from "vitest";

// deleteChapter is destructive: it removes the chapter and (via cascade) all its
// children. The NO-ACTION children (media, partners, team_join_requests) plus the
// chapter are removed ATOMICALLY by the delete_chapter_cascade Postgres function
// (one transaction), so a mid-way failure can't leave a half-deleted chapter.
// These tests pin: the global-admin-only gate, that the atomic RPC is called with
// the chapter id, error surfacing, and the audit log.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  logEvent: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
// getAdminUserId (local to admin.ts) calls createClient().auth.getUser(); give it
// a working stub so the audit-log actor resolves.
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { deleteChapter } from "@/lib/actions/admin";

const CHAPTER = "chapter-1";

// Mock admin client: a chapter-name lookup (.from().select().eq().single()) and
// an atomic .rpc("delete_chapter_cascade", ...). `rpcError` simulates the
// transaction failing.
function makeAdminClient(opts: {
  chapterRow?: { name: string } | null;
  rpcError?: { message: string };
  rpcCalls: Array<{ fn: string; args: unknown }>;
}) {
  return {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve({ data: opts.chapterRow, error: null }),
      };
      return builder;
    },
    rpc: (fn: string, args: unknown) => {
      opts.rpcCalls.push({ fn, args });
      return Promise.resolve({
        error: opts.rpcError ? { message: opts.rpcError.message } : null,
      });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null); // global admin by default
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
  });
});

describe("deleteChapter", () => {
  it("rejects a caller who is not a global admin (chapter admins cannot delete)", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const res = await deleteChapter(CHAPTER);
    expect(res).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 'not found' when the chapter does not exist (no delete attempted)", async () => {
    const rpcCalls: Array<{ fn: string; args: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ chapterRow: null, rpcCalls }));
    const res = await deleteChapter(CHAPTER);
    expect(res).toEqual({ error: "Chapter not found." });
    expect(rpcCalls).toHaveLength(0);
  });

  it("deletes the chapter atomically via the cascade RPC and audit-logs it", async () => {
    const rpcCalls: Array<{ fn: string; args: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ chapterRow: { name: "Paris Match" }, rpcCalls })
    );

    const res = await deleteChapter(CHAPTER);
    expect(res).toEqual({ success: true });

    // Exactly one atomic RPC, scoped to this chapter.
    expect(rpcCalls).toEqual([
      { fn: "delete_chapter_cascade", args: { target_chapter_id: CHAPTER } },
    ]);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chapter.deleted",
        entityType: "chapter",
        entityId: CHAPTER,
      })
    );
  });

  it("surfaces an error and does NOT audit-log if the cascade RPC fails", async () => {
    const rpcCalls: Array<{ fn: string; args: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        chapterRow: { name: "Paris Match" },
        rpcError: { message: "fk violation" },
        rpcCalls,
      })
    );

    const res = await deleteChapter(CHAPTER);
    expect(res.error).toBeTruthy();
    expect(res).not.toHaveProperty("success");
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
