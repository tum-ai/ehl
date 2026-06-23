import { describe, it, expect, vi, beforeEach } from "vitest";

// inviteChapterAdmin / removeChapterAdmin pre-provision accounts and flip roles,
// so we verify the authorization gate (global-admin only) and the exact writes:
// an invite sets role=chapter_admin and inserts a chapter_admins row; a removal
// deletes the row and downgrades the role when no assignments remain.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  isAdminEmail: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/admin-allowlist", () => ({ isAdminEmail: mocks.isAdminEmail }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));

import {
  inviteChapterAdmin,
  removeChapterAdmin,
} from "@/lib/actions/chapter-admins";

const CHAPTER = "chapter-a";
const CALLER = "caller-admin";

// Minimal chainable Supabase mock. `responder(state)` returns the result for a
// given table/op/filters; every terminal call is also recorded in `calls`.
function makeAdminClient(opts: {
  responder: (s: {
    table: string;
    op: string;
    filters: [string, unknown][];
    payload: unknown;
  }) => unknown;
  createUser?: () => unknown;
  generateLink?: () => unknown;
  calls: Array<{ table: string; op: string; payload: unknown }>;
}) {
  function makeBuilder() {
    const state = {
      table: "",
      op: "select",
      filters: [] as [string, unknown][],
      payload: null as unknown,
    };
    const resolve = () => {
      opts.calls.push({ table: state.table, op: state.op, payload: state.payload });
      return Promise.resolve(opts.responder(state));
    };
    const builder: Record<string, unknown> = {
      select: (_c?: unknown, _o?: unknown) => ((state.op = "select"), builder),
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      upsert: (p: unknown) => ((state.op = "upsert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
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
    auth: {
      admin: {
        createUser:
          opts.createUser ??
          (() => ({ data: { user: { id: "new-user" } }, error: null })),
        generateLink:
          opts.generateLink ??
          (() => ({ data: { user: { id: "recovered-user" } }, error: null })),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null); // global admin by default
  mocks.isAdminEmail.mockResolvedValue(false);
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: CALLER } } }) },
  });
});

describe("inviteChapterAdmin", () => {
  it("rejects a caller who is not a global admin", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const result = await inviteChapterAdmin("p@partner.com", "Pat", CHAPTER);
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const result = await inviteChapterAdmin("not-an-email", "Pat", CHAPTER);
    expect(result.error).toMatch(/valid email/i);
  });

  it("pre-provisions the user, sets role, and writes the assignment", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapters" && op === "select") return { data: { id: CHAPTER } };
          if (table === "profiles" && op === "select") return { data: null };
          if (table === "chapter_admins" && op === "select") return { data: null };
          return { data: null, error: null };
        },
      })
    );

    const result = await inviteChapterAdmin("p@partner.com", "Pat", CHAPTER);
    expect(result).toEqual({ success: true });

    const profileUpsert = calls.find(
      (c) => c.table === "profiles" && c.op === "upsert"
    );
    expect((profileUpsert?.payload as { role: string }).role).toBe("chapter_admin");

    const assignment = calls.find(
      (c) => c.table === "chapter_admins" && c.op === "insert"
    );
    expect(assignment?.payload).toMatchObject({
      user_id: "new-user",
      chapter_id: CHAPTER,
      invited_by: CALLER,
    });
    expect(mocks.logEvent).toHaveBeenCalled();
  });

  it("recovers an orphaned auth user instead of failing on 'already registered'", async () => {
    // A prior invite created the auth user but failed before writing the profile
    // (e.g. a missing migration), leaving no profile row. The retry must not dead-
    // end on "already registered": it recovers the existing user via generateLink
    // and completes the assignment.
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        // No profile row exists yet, so the action goes down the create path.
        createUser: () => ({
          data: { user: null },
          error: { message: "A user with this email address has already been registered" },
        }),
        generateLink: () => ({ data: { user: { id: "recovered-user" } }, error: null }),
        responder: ({ table, op }) => {
          if (table === "chapters" && op === "select") return { data: { id: CHAPTER } };
          if (table === "profiles" && op === "select") return { data: null };
          if (table === "chapter_admins" && op === "select") return { data: null };
          return { data: null, error: null };
        },
      })
    );

    const result = await inviteChapterAdmin("p@partner.com", "Pat", CHAPTER);
    expect(result).toEqual({ success: true });

    const assignment = calls.find(
      (c) => c.table === "chapter_admins" && c.op === "insert"
    );
    expect(assignment?.payload).toMatchObject({
      user_id: "recovered-user",
      chapter_id: CHAPTER,
      invited_by: CALLER,
    });
  });

  it("returns the original error when the user truly cannot be provisioned", async () => {
    // createUser fails AND the user can't be recovered (no existing account):
    // surface the real error rather than silently succeeding.
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls: [],
        createUser: () => ({
          data: { user: null },
          error: { message: "Database error creating new user" },
        }),
        generateLink: () => ({ data: { user: null }, error: { message: "not found" } }),
        responder: ({ table, op }) => {
          if (table === "chapters" && op === "select") return { data: { id: CHAPTER } };
          if (table === "profiles" && op === "select") return { data: null };
          return { data: null, error: null };
        },
      })
    );

    const result = await inviteChapterAdmin("p@partner.com", "Pat", CHAPTER);
    expect(result.error).toMatch(/Database error creating new user/);
  });

  it("does not create a duplicate assignment", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapters" && op === "select") return { data: { id: CHAPTER } };
          if (table === "profiles" && op === "select") return { data: { id: "u" } };
          // Already a local admin of this chapter.
          if (table === "chapter_admins" && op === "select")
            return { data: { user_id: "u" } };
          return { data: null, error: null };
        },
      })
    );

    const result = await inviteChapterAdmin("p@partner.com", "Pat", CHAPTER);
    expect(result.error).toMatch(/already a local admin/i);
    expect(
      calls.find((c) => c.table === "chapter_admins" && c.op === "insert")
    ).toBeUndefined();
  });
});

describe("removeChapterAdmin", () => {
  it("rejects a caller who is not a global admin", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const result = await removeChapterAdmin("u", CHAPTER);
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("deletes the assignment and downgrades the role when none remain", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapter_admins" && op === "delete") return { error: null };
          if (table === "profiles" && op === "select")
            return { data: { email: "p@partner.com", role: "chapter_admin" } };
          // No remaining chapter_admins rows for this user.
          if (table === "chapter_admins" && op === "select") return { count: 0 };
          return { data: null, error: null };
        },
      })
    );

    const result = await removeChapterAdmin("u", CHAPTER);
    expect(result).toEqual({ success: true });

    const downgrade = calls.find(
      (c) => c.table === "profiles" && c.op === "update"
    );
    expect((downgrade?.payload as { role: string }).role).toBe("participant");
  });
});
