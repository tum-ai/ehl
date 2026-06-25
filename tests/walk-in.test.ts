import { describe, it, expect, vi, beforeEach } from "vitest";

// Walk-in registration: a no-show spot filled at the event. A person scans the
// per-chapter walk-in QR, fills the application form AND creates an account in one
// step, and becomes an auto-accepted full league participant. We pin:
//   - happy path creates the auth user + profile and inserts an application with
//     status "accepted", returning the auto-generated check_in_token
//   - the unguessable TOKEN replaces the applications_open status gate: it
//     succeeds during "hacking" and "submissions_open"
//   - an invalid token creates NOTHING
//   - turnstile failure creates NOTHING
//   - a duplicate (chapter,email) application is refused, no account created
//   - an EXISTING account email is refused ("sign in first"), no createUser, no insert
//   - the CV is optional (omitted -> success)
//   - rotateWalkInToken is admin-guarded
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  requireChapterAdminAction: vi.fn(),
  getSession: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  checkRateLimit: vi.fn(),
  uploadFile: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createServerClient }));
vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminAction: mocks.requireChapterAdminAction,
}));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: mocks.verifyTurnstileToken }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  applicationLimiter: {},
  walkInTokenLimiter: {},
}));
vi.mock("@/lib/gdrive", () => ({ uploadFile: mocks.uploadFile }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("next/headers", () => ({
  headers: () => ({ get: () => "1.2.3.4" }),
}));

import {
  submitWalkInApplication,
  rotateWalkInToken,
} from "@/lib/actions/walk-in";

const TOKEN = "walk-in-token-abc";
const CHAPTER_ID = "chapter-1";

// ── Chainable Supabase mock ──────────────────────────────────
// A `responder` decides what each terminal call resolves to, keyed by table+op.
// All writes/reads are recorded in `calls` for assertions.
function makeAdminClient(opts: {
  responder: (s: {
    table: string;
    op: string;
    filters: [string, unknown][];
    payload: unknown;
  }) => unknown;
  calls: Array<{ table: string; op: string; payload: unknown }>;
  auth?: { createUser: ReturnType<typeof vi.fn> };
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
      select: () => ((state.op = state.op === "select" ? "select" : state.op), builder),
      insert: (p: unknown) => ((state.op = "insert"), (state.payload = p), builder),
      update: (p: unknown) => ((state.op = "update"), (state.payload = p), builder),
      upsert: (p: unknown) => ((state.op = "upsert"), (state.payload = p), builder),
      delete: () => ((state.op = "delete"), builder),
      eq: (k: string, v: unknown) => (state.filters.push([k, v]), builder),
      maybeSingle: () => resolve(),
      single: () => resolve(),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        resolve().then(onF, onR),
    };
    return { builder, state };
  }
  return {
    auth: {
      admin: {
        createUser:
          opts.auth?.createUser ??
          vi.fn().mockResolvedValue({ data: { user: { id: "new-user-1" } }, error: null }),
      },
    },
    from(table: string) {
      const { builder, state } = makeBuilder();
      state.table = table;
      return builder;
    },
  };
}

function baseForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("walkInToken", TOKEN);
  fd.set("firstName", "Walk");
  fd.set("lastName", "In");
  fd.set("email", "walkin@example.com");
  fd.set("password", "supersecret");
  fd.set("cf-turnstile-response", "tok");
  fd.set("discoverySource", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

// Standard responder: token resolves to a chapter with `status`, no duplicate
// app, no existing profile, insert returns an id + check_in_token.
function happyResponder(status = "hacking") {
  return ({ table, op }: { table: string; op: string }) => {
    if (table === "chapter_walk_in" && op === "select")
      return { data: { chapter_id: CHAPTER_ID } };
    if (table === "chapters" && op === "select")
      return {
        data: {
          id: CHAPTER_ID,
          name: "Paris",
          city: "Paris",
          country: "France",
          date: "2026-07-01",
          date_end: null,
          slug: "paris",
          status,
        },
      };
    if (table === "applications" && op === "select") return { data: null }; // no duplicate
    if (table === "profiles" && op === "select") return { data: null }; // no existing account
    if (table === "applications" && op === "insert")
      return { data: { id: "app-1", check_in_token: "checkin-xyz" }, error: null };
    if (table === "profiles" && op === "upsert") return { data: null, error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTurnstileToken.mockResolvedValue(true);
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.requireChapterAdminAction.mockResolvedValue(null);
  mocks.getSession.mockResolvedValue({ profile: { id: "admin-1" } });
  mocks.createServerClient.mockResolvedValue({
    auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
  });
});

describe("submitWalkInApplication", () => {
  it("happy path: creates user + profile, inserts accepted application, returns check_in_token", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    const createUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "new-user-1" } }, error: null });
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: happyResponder("hacking"), auth: { createUser } })
    );

    const result = await submitWalkInApplication(baseForm());
    expect(result).toEqual({ success: true, checkInToken: "checkin-xyz", cvUploadFailed: false });

    // Account created.
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "walkin@example.com", email_confirm: true })
    );
    const profile = calls.find((c) => c.table === "profiles" && c.op === "upsert");
    expect(profile?.payload).toMatchObject({ id: "new-user-1", role: "participant" });

    // Application inserted as accepted.
    const insert = calls.find((c) => c.table === "applications" && c.op === "insert");
    expect(insert?.payload).toMatchObject({
      chapter_id: CHAPTER_ID,
      email: "walkin@example.com",
      status: "accepted",
    });

    // Logged + signed in.
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "application.walk_in_registered" })
    );
  });

  it("token gate replaces status gate: succeeds when chapter status is 'hacking'", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: happyResponder("hacking") })
    );
    const result = await submitWalkInApplication(baseForm());
    expect("success" in result && result.success).toBe(true);
  });

  it("token gate replaces status gate: succeeds when chapter status is 'submissions_open'", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: happyResponder("submissions_open") })
    );
    const result = await submitWalkInApplication(baseForm());
    expect("success" in result && result.success).toBe(true);
  });

  it("rejects draft/completed statuses (hygiene) without creating anything", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    const createUser = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: happyResponder("completed"), auth: { createUser } })
    );
    const result = await submitWalkInApplication(baseForm());
    expect("error" in result).toBe(true);
    expect(createUser).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "applications" && c.op === "insert")).toBeUndefined();
  });

  it("invalid token: errors and creates no user / no application", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    const createUser = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapter_walk_in" && op === "select") return { data: null }; // no such token
          return { data: null, error: null };
        },
        auth: { createUser },
      })
    );
    const result = await submitWalkInApplication(baseForm());
    expect(result).toEqual({ error: "Invalid walk-in link." });
    expect(createUser).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "applications" && c.op === "insert")).toBeUndefined();
  });

  it("turnstile failure: creates nothing", async () => {
    mocks.verifyTurnstileToken.mockResolvedValue(false);
    const result = await submitWalkInApplication(baseForm());
    expect("error" in result && result.error).toMatch(/bot verification/i);
    // The admin client is never even constructed.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("duplicate (chapter,email) application: refused, no user created", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    const createUser = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapter_walk_in" && op === "select")
            return { data: { chapter_id: CHAPTER_ID } };
          if (table === "chapters" && op === "select")
            return { data: { id: CHAPTER_ID, name: "Paris", status: "hacking" } };
          if (table === "applications" && op === "select") return { data: { id: "existing-app" } };
          return { data: null, error: null };
        },
        auth: { createUser },
      })
    );
    const result = await submitWalkInApplication(baseForm());
    expect("error" in result && result.error).toMatch(/already exists/i);
    expect(createUser).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "applications" && c.op === "insert")).toBeUndefined();
  });

  it("existing account email: refuses with 'sign in first', no createUser, no insert", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    const createUser = vi.fn();
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapter_walk_in" && op === "select")
            return { data: { chapter_id: CHAPTER_ID } };
          if (table === "chapters" && op === "select")
            return { data: { id: CHAPTER_ID, name: "Paris", status: "hacking" } };
          if (table === "applications" && op === "select") return { data: null }; // no dup app
          if (table === "profiles" && op === "select") return { data: { id: "existing-user" } };
          return { data: null, error: null };
        },
        auth: { createUser },
      })
    );
    const result = await submitWalkInApplication(baseForm());
    expect("error" in result && result.error).toMatch(/sign in first/i);
    expect(createUser).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === "applications" && c.op === "insert")).toBeUndefined();
    expect(calls.find((c) => c.table === "profiles" && c.op === "upsert")).toBeUndefined();
  });

  it("CV omitted: succeeds without touching Drive", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ calls, responder: happyResponder("hacking") })
    );
    const result = await submitWalkInApplication(baseForm()); // no cv field
    expect("success" in result && result.success).toBe(true);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters before any DB work", async () => {
    const result = await submitWalkInApplication(baseForm({ password: "short" }));
    expect("error" in result && result.error).toMatch(/at least 8/i);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("rotateWalkInToken", () => {
  it("rejects an unauthorized caller and writes nothing", async () => {
    mocks.requireChapterAdminAction.mockResolvedValue("Admin access required.");
    const result = await rotateWalkInToken(CHAPTER_ID);
    expect(result).toEqual({ error: "Admin access required." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("admin: writes a fresh token and logs the rotation", async () => {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        calls,
        responder: ({ table, op }) => {
          if (table === "chapter_walk_in" && op === "upsert")
            return { data: { walk_in_token: "rotated-token" }, error: null };
          return { data: null, error: null };
        },
      })
    );
    const result = await rotateWalkInToken(CHAPTER_ID);
    expect(result).toEqual({ token: "rotated-token" });

    const upsert = calls.find((c) => c.table === "chapter_walk_in" && c.op === "upsert");
    expect(upsert?.payload).toMatchObject({ chapter_id: CHAPTER_ID, rotated_by: "admin-1" });
    expect((upsert?.payload as { walk_in_token: string }).walk_in_token).toBeTruthy();

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chapter.walk_in_token_rotated" })
    );
  });
});
