import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression guard for the single-person-team bug: registerForChallenge (the
// challenge_selection / public-match path) inserted a challenge_registrations
// row with NO minimum-size check. A one-member team could therefore select a
// challenge. The fix (a) derives the roster ONLY from the team's actual
// team_members rows, ignoring the client-supplied roster, and (b) enforces
// MIN_CHALLENGE_ROSTER (2). These tests pin that:
//   1. a solo team (1 member) is rejected, and NO registration row is written
//   2. a valid team (2 members, all checked in) passes the size guard and inserts
//   3. a crafted non-empty client roster cannot pad a solo team: the server
//      ignores it and uses the real membership

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = vi.fn<any>();
const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));
// All roster members report as checked in unless a test overrides this.
const checkinMock = vi.fn();
vi.mock("@/lib/queries/checkin", () => ({
  getCheckinStatusForUsers: (ids: string[], _chapter: string) => checkinMock(ids),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/event-log", () => ({ logEvent: vi.fn() }));

import { registerForChallenge } from "@/lib/actions/submissions";
import { registerChallenge } from "@/lib/actions/event";

const PRESIDENT = "user-pres";
const CHAPTER = "chapter-1";
const CHALLENGE = "challenge-1";
const TEAM = "team-1";

// Wire the admin-client chain for each table the action touches, in order:
// teams (president), chapters (status/deadline), team_members (roster),
// challenge_registrations (existing check + insert/update).
function wireTables(opts: {
  members: { user_id: string }[];
  existingRegistration?: { id: string; challenge_id?: string } | null;
  insertResult?: { error: { message: string } | null };
  maxTeams?: number | null;
  registeredCount?: number;
}) {
  const insertSpy = vi.fn().mockResolvedValue(opts.insertResult ?? { error: null });
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue(opts.insertResult ?? { error: null }),
  };
  updateChain.update.mockReturnValue(updateChain);

  (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === "teams") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { president_user_id: PRESIDENT } });
      return c;
    }
    if (table === "chapters") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({
        data: { status: "challenge_selection", challenge_selection_deadline: null },
      });
      return c;
    }
    if (table === "team_members") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockResolvedValue({ data: opts.members });
      return c;
    }
    if (table === "profiles") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.in = vi.fn().mockResolvedValue({ data: [] });
      return c;
    }
    if (table === "challenges") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { max_teams: opts.maxTeams ?? null } });
      return c;
    }
    if (table === "challenge_registrations") {
      // Two distinct call shapes share this table: the existing-registration
      // lookup (.select("id, challenge_id").eq().eq().single()) and the
      // capacity count (.select("id", { count, head: true }).eq()). Both start
      // with .select().eq(), so the chain must satisfy either continuation.
      const countThenable = Promise.resolve({ count: opts.registeredCount ?? 0 });
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockImplementation(() => ({
        ...c,
        then: countThenable.then.bind(countThenable),
      }));
      c.single = vi.fn().mockResolvedValue({ data: opts.existingRegistration ?? null });
      c.insert = insertSpy;
      c.update = updateChain.update;
      return c;
    }
    return {};
  });

  return { insertSpy };
}

describe("registerForChallenge minimum team size", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: PRESIDENT } } });
    checkinMock.mockImplementation((ids: string[]) => new Map(ids.map((id) => [id, true])));
  });

  it("rejects a solo team and writes NO registration", async () => {
    const { insertSpy } = wireTables({ members: [{ user_id: PRESIDENT }] });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.error).toMatch(/2 to 5 members/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows a valid 2-member, fully-checked-in team to register", async () => {
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.success).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    // The inserted roster is exactly the two unique members.
    expect(insertSpy.mock.calls[0][0].roster.sort()).toEqual([PRESIDENT, "user-2"].sort());
  });

  it("ignores a crafted client roster: a solo team cannot pad itself via the roster arg", async () => {
    // The team genuinely has ONE member. A malicious president calls the action
    // directly with a roster that names other (checked-in) users. The server
    // must ignore that roster and use the real membership, so it stays rejected.
    const { insertSpy } = wireTables({ members: [{ user_id: PRESIDENT }] });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, [
      PRESIDENT,
      "outsider-1",
      "outsider-2",
    ]);

    expect(result.error).toMatch(/2 to 5 members/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("ignores a crafted client roster on a valid team: inserts only real members", async () => {
    // A valid 2-member team; the president passes an inflated roster. The stored
    // roster must be exactly the real members, never the client-supplied list.
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, [
      PRESIDENT,
      "user-2",
      "outsider-x",
    ]);

    expect(result.success).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0].roster.sort()).toEqual([PRESIDENT, "user-2"].sort());
  });
});

describe("registerForChallenge capacity limit (max_teams)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: PRESIDENT } } });
    checkinMock.mockImplementation((ids: string[]) => new Map(ids.map((id) => [id, true])));
  });

  it("rejects registration once the challenge is at capacity", async () => {
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      maxTeams: 2,
      registeredCount: 2,
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.error).toBe("This challenge is full.");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows registration when under capacity", async () => {
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      maxTeams: 2,
      registeredCount: 1,
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.success).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("allows unlimited capacity when max_teams is null", async () => {
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      maxTeams: null,
      registeredCount: 500,
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.success).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("does not block a team re-registering into its OWN already-full challenge (switch no-op)", async () => {
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      existingRegistration: { id: "reg-1", challenge_id: CHALLENGE },
      maxTeams: 2,
      registeredCount: 2,
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.success).toBe(true);
    // Existing registration into the SAME challenge takes the update path, not insert.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("blocks a team switching INTO a different, now-full challenge", async () => {
    const { insertSpy } = wireTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      existingRegistration: { id: "reg-1", challenge_id: "some-other-challenge" },
      maxTeams: 2,
      registeredCount: 2,
    });

    const result = await registerForChallenge(CHAPTER, CHALLENGE, TEAM, []);

    expect(result.error).toBe("This challenge is full.");
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ─── registerChallenge (event-hub path) ───────────────────────────────────
// The event-hub action takes a client-supplied roster and validates it. It must
// reject a too-small team even when the roster is duplicate-padded (e.g. a solo
// president passing [self, self]) — the guard dedupes before counting size.
function wireEventTables(opts: {
  members: { user_id: string }[];
  insertResult?: { error: { message: string } | null };
  maxTeams?: number | null;
  registeredCount?: number;
}) {
  const insertSpy = vi.fn().mockResolvedValue(opts.insertResult ?? { error: null });
  const countThenable = Promise.resolve({ count: opts.registeredCount ?? 0 });
  (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const c: Record<string, unknown> = {};
    if (table === "teams") {
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { president_user_id: PRESIDENT } });
    } else if (table === "profiles") {
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.in = vi.fn().mockResolvedValue({ data: [] });
      c.single = vi.fn().mockResolvedValue({ data: { email: "pres@test.com" } });
    } else if (table === "applications") {
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { status: "checked_in" } });
    } else if (table === "chapters") {
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({
        data: { challenge_registration_enabled: true, status: "challenge_selection" },
      });
    } else if (table === "challenges") {
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: { id: CHALLENGE, max_teams: opts.maxTeams ?? null } });
    } else if (table === "team_members") {
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockResolvedValue({ data: opts.members });
    } else if (table === "challenge_registrations") {
      // Same dual-shape chain as wireTables: existing-check (.eq().single())
      // and capacity count (.eq() awaited directly).
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockImplementation(() => ({
        ...c,
        then: countThenable.then.bind(countThenable),
      }));
      c.single = vi.fn().mockResolvedValue({ data: null });
      c.insert = insertSpy;
    }
    return c;
  });
  return { insertSpy };
}

describe("registerChallenge minimum team size (event-hub path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: PRESIDENT } } });
    checkinMock.mockImplementation((ids: string[]) => new Map(ids.map((id) => [id, true])));
  });

  it("rejects a solo team that duplicate-pads its roster, and writes nothing", async () => {
    const { insertSpy } = wireEventTables({ members: [{ user_id: PRESIDENT }] });

    // Solo president tries [self, self] to fake a 2-member roster.
    const result = await registerChallenge(CHAPTER, CHALLENGE, TEAM, [PRESIDENT, PRESIDENT]);

    expect(result.error).toMatch(/2 to 5 members/);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows a genuine 2-member roster and stores the deduped members", async () => {
    const { insertSpy } = wireEventTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
    });

    const result = await registerChallenge(CHAPTER, CHALLENGE, TEAM, [PRESIDENT, "user-2"]);

    expect(result.success).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0].roster.sort()).toEqual([PRESIDENT, "user-2"].sort());
  });
});

describe("registerChallenge capacity limit (max_teams, event-hub path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: PRESIDENT } } });
    checkinMock.mockImplementation((ids: string[]) => new Map(ids.map((id) => [id, true])));
  });

  it("rejects registration once the challenge is at capacity", async () => {
    const { insertSpy } = wireEventTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      maxTeams: 2,
      registeredCount: 2,
    });

    const result = await registerChallenge(CHAPTER, CHALLENGE, TEAM, [PRESIDENT, "user-2"]);

    expect(result.error).toBe("This challenge is full.");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows registration when under capacity", async () => {
    const { insertSpy } = wireEventTables({
      members: [{ user_id: PRESIDENT }, { user_id: "user-2" }],
      maxTeams: 2,
      registeredCount: 1,
    });

    const result = await registerChallenge(CHAPTER, CHALLENGE, TEAM, [PRESIDENT, "user-2"]);

    expect(result.success).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
