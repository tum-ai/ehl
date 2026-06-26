import { describe, it, expect, vi, beforeEach } from "vitest";

// REGRESSION: deleteParticipant() used to swallow every delete error and return
// { success: true } unconditionally. When profiles.delete() failed on the
// event_log.actor_id FK (RESTRICT), the admin saw "deleted" but the user
// reappeared in search. Now every step is error-checked and the real error is
// returned (admin-only path, no security risk). We assert:
//   1. A failing dependent delete aborts and returns the real error.
//   2. A failing auth.admin.deleteUser aborts and returns the real error.
//   3. The happy path deletes auth user (cascading the profile) and succeeds.
//   4. Admin accounts cannot be deleted.
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
  requireChapterAdminAction: mocks.requireChapterAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/event-log", () => ({
  logEvent: mocks.logEvent,
  logEventStrict: mocks.logEventStrict,
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/emails/render", () => ({ renderCertificateEmail: vi.fn() }));

import { deleteParticipant } from "@/lib/actions/admin";

const USER = "user-1";

/**
 * Build an admin client whose .from(table).delete()/update()/select() resolves
 * via `responder`, and whose auth.admin.deleteUser resolves via `authResult`.
 */
interface DeleteCall {
  table: string;
  col: string;
  val: unknown;
}

function makeClient(opts: {
  responder?: (table: string, op: string) => unknown;
  authResult?: unknown;
  deleteUser?: ReturnType<typeof vi.fn>;
  deleteCalls?: DeleteCall[];
}) {
  const responder = opts.responder ?? (() => ({ data: null, error: null }));
  function builder(table: string) {
    let op = "select";
    const eqArgs: [string, unknown][] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      delete: () => ((op = "delete"), b),
      update: () => ((op = "update"), b),
      eq: (col: string, val: unknown) => {
        eqArgs.push([col, val]);
        if (op === "delete" && opts.deleteCalls) {
          opts.deleteCalls.push({ table, col, val });
        }
        return b;
      },
      in: () => b,
      single: () => Promise.resolve(responder(table, "select")),
      maybeSingle: () => Promise.resolve(responder(table, "select")),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(responder(table, op)).then(onF, onR),
    };
    return b;
  }
  return {
    from: (table: string) => builder(table),
    auth: {
      admin: {
        deleteUser:
          opts.deleteUser ??
          vi.fn().mockResolvedValue(opts.authResult ?? { error: null }),
      },
    },
  };
}

// Default: profile exists, not an admin, all deletes succeed.
function happyResponder(table: string, op: string) {
  if (table === "profiles" && op === "select")
    return { data: { email: "p@x.com", name: "Pat" } };
  if (table === "admin_emails" && op === "select") return { data: null };
  if (table === "team_members" && op === "select") return { data: [] };
  return { data: null, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
});

describe("deleteParticipant — errors surfaced, not swallowed", () => {
  it("aborts and returns the real error when a dependent delete fails", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeClient({
        responder: (table, op) => {
          if (table === "profiles" && op === "select")
            return { data: { email: "p@x.com", name: "Pat" } };
          if (table === "admin_emails" && op === "select") return { data: null };
          if (table === "applications" && op === "delete")
            return { error: { message: "FK violation on applications" } };
          if (table === "team_members" && op === "select") return { data: [] };
          return { data: null, error: null };
        },
      })
    );

    const result = await deleteParticipant(USER);
    expect(result.error).toMatch(/applications.*FK violation/i);
  });

  it("aborts and returns the real error when auth deletion fails", async () => {
    const deleteUser = vi
      .fn()
      .mockResolvedValue({ error: { message: "auth user not found" } });
    mocks.createAdminClient.mockReturnValue(
      makeClient({ responder: happyResponder, deleteUser })
    );

    const result = await deleteParticipant(USER);
    expect(result.error).toMatch(/auth user.*not found/i);
    expect(deleteUser).toHaveBeenCalledWith(USER);
  });

  it("succeeds when auth user is deleted and the profile is gone", async () => {
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue(
      makeClient({ responder: happyResponder, deleteUser })
    );

    const result = await deleteParticipant(USER);
    expect(result).toEqual({ success: true });
    expect(deleteUser).toHaveBeenCalledWith(USER);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "participant.deleted" })
    );
  });

  it("deletes participant_flags by NORMALIZED email, not a nonexistent profile_id", async () => {
    // REGRESSION: participant_flags has no profile_id column (email/created_by/
    // resolved_by). Matching by profile_id errored and broke deletion. Flags are
    // stored with email.toLowerCase().trim(), so the delete must use that.
    const deleteCalls: DeleteCall[] = [];
    mocks.createAdminClient.mockReturnValue(
      makeClient({
        responder: (table, op) => {
          if (table === "profiles" && op === "select")
            return { data: { email: "  Pat@X.com ", name: "Pat" } };
          if (table === "admin_emails" && op === "select") return { data: null };
          if (table === "team_members" && op === "select") return { data: [] };
          return { data: null, error: null };
        },
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
        deleteCalls,
      })
    );

    const result = await deleteParticipant(USER);
    expect(result).toEqual({ success: true });

    const flagDelete = deleteCalls.find((c) => c.table === "participant_flags");
    expect(flagDelete).toBeDefined();
    expect(flagDelete?.col).toBe("email");
    expect(flagDelete?.val).toBe("pat@x.com"); // normalized
    // And it must NEVER use the nonexistent profile_id column.
    expect(deleteCalls.some((c) => c.table === "participant_flags" && c.col === "profile_id")).toBe(false);
  });

  it("refuses to delete an admin account", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeClient({
        responder: (table, op) => {
          if (table === "profiles" && op === "select")
            return { data: { email: "admin@x.com", name: "Boss" } };
          if (table === "admin_emails" && op === "select")
            return { data: { email: "admin@x.com" } };
          return { data: null, error: null };
        },
      })
    );

    const result = await deleteParticipant(USER);
    expect(result.error).toMatch(/cannot delete admin/i);
  });

  it("returns not-found when the profile does not exist", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeClient({ responder: () => ({ data: null }) })
    );
    const result = await deleteParticipant(USER);
    expect(result.error).toMatch(/not found/i);
  });

  it("rejects a non-admin caller before any DB access", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const result = await deleteParticipant(USER);
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
