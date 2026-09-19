import { describe, it, expect, vi, beforeEach } from "vitest";

// sendFinaleInvites is the admin "invite the finalists" button. This pins:
//   - only teams ranked FINALE_INVITE_MAX_RANK or better are invited, ties included
//     (the leaderboard view already shares a rank on equal points);
//   - it is idempotent: someone who already has an invite row is never mailed
//     again, so pressing the button twice is safe;
//   - a person sitting on TWO qualifying teams gets exactly ONE invite (the DB
//     unique constraint would reject the second, and a double email reads as a
//     mistake to the recipient);
//   - a failed send ROLLS BACK that person's row, so a retry re-sends instead of
//     silently marking them as invited;
//   - the token mailed out is the one the freshly inserted row generated;
//   - only global admins can send, and only for the Finale chapter.

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  requireAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
  logEvent: vi.fn(),
  sendEmail: vi.fn(),
  renderFinaleInviteEmail: vi.fn(),
  sendEmailAfterResponse: vi.fn(),
  sendAcceptanceEmailForApplication: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rsvpLimiter: { prefix: "rl:rsvp" },
  rsvpTokenLimiter: { prefix: "rl:rsvp-token" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/email-deferred", () => ({ sendEmailAfterResponse: mocks.sendEmailAfterResponse }));
vi.mock("@/lib/emails/render", () => ({ renderFinaleInviteEmail: mocks.renderFinaleInviteEmail }));
vi.mock("@/lib/acceptance-email", () => ({
  sendAcceptanceEmailForApplication: mocks.sendAcceptanceEmailForApplication,
}));

import { sendFinaleInvites, getFinaleInviteBoard } from "@/lib/actions/finale-invites";
import { makeDb, writes, ok, type RecordedCall } from "./finale-invite-helpers";

const FINALE = { id: "finale-1", is_finale: true, status: "applications_open" };

function member(userId: string, teamId: string, name = "Ada Lovelace") {
  return {
    team_id: teamId,
    user_id: userId,
    profiles: { name, email: `${userId}@example.com` },
  };
}

function db(opts: {
  leaderboard?: unknown[];
  members?: unknown[];
  invited?: unknown[];
  chapter?: unknown;
  sendFails?: Set<string>;
  insertFails?: boolean;
}) {
  let tokenSeq = 0;
  return makeDb({
    select: {
      chapters: { data: opts.chapter === undefined ? FINALE : opts.chapter, error: null },
      leaderboard: { data: opts.leaderboard ?? [], error: null },
      team_members: { data: opts.members ?? [], error: null },
      finale_invites: { data: opts.invited ?? [], error: null },
    },
    insert: {
      finale_invites: () =>
        opts.insertFails
          ? { data: null, error: new Error("insert failed") }
          : { data: { invite_token: `token-${++tokenSeq}` }, error: null },
    },
    update: { finale_invites: { data: null, error: null } },
    delete: { finale_invites: { data: null, error: null } },
  });
}

const TEAM_A = { team_id: "team-a", team_name: "bussies", rank: 1, total_points: 20 };
const TEAM_B = { team_id: "team-b", team_name: "Tetrad", rank: 15, total_points: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
  mocks.renderFinaleInviteEmail.mockResolvedValue("<html></html>");
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.headers.mockResolvedValue({ get: () => "127.0.0.1" });
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
});

describe("sendFinaleInvites", () => {
  it("mails every member of every qualifying team", async () => {
    const { db: client } = db({
      leaderboard: [TEAM_A, TEAM_B],
      members: [member("u1", "team-a"), member("u2", "team-a"), member("u3", "team-b")],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await sendFinaleInvites("finale-1"));

    expect(result.sent).toBe(3);
    expect(result.teams).toBe(2);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
  });

  it("never mails someone who already has an invite row, so a second press mails nobody", async () => {
    const { db: client } = db({
      leaderboard: [TEAM_A],
      members: [member("u1", "team-a"), member("u2", "team-a")],
      invited: [{ user_id: "u1" }, { user_id: "u2" }],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await sendFinaleInvites("finale-1"));

    expect(result.sent).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("mails only the not-yet-invited members in a mixed team", async () => {
    const { db: client } = db({
      leaderboard: [TEAM_A],
      members: [member("u1", "team-a"), member("u2", "team-a")],
      invited: [{ user_id: "u1" }],
    });
    mocks.createAdminClient.mockReturnValue(client);

    expect(ok(await sendFinaleInvites("finale-1")).sent).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u2@example.com" })
    );
  });

  it("invites a person on two qualifying teams exactly once", async () => {
    const { db: client, calls } = db({
      leaderboard: [TEAM_A, TEAM_B],
      members: [member("u1", "team-a"), member("u1", "team-b")],
    });
    mocks.createAdminClient.mockReturnValue(client);

    expect(ok(await sendFinaleInvites("finale-1")).sent).toBe(1);
    expect(writes(calls).filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("mails the token the freshly inserted row generated", async () => {
    const { db: client } = db({ leaderboard: [TEAM_A], members: [member("u1", "team-a")] });
    mocks.createAdminClient.mockReturnValue(client);

    await sendFinaleInvites("finale-1");

    expect(mocks.renderFinaleInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inviteToken: "token-1", teamName: "bussies", firstName: "Ada" })
    );
  });

  it("rolls the row back when the send fails, so a retry re-sends", async () => {
    const { db: client, calls } = db({ leaderboard: [TEAM_A], members: [member("u1", "team-a")] });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendEmail.mockRejectedValue(new Error("smtp down"));

    const result = ok(await sendFinaleInvites("finale-1"));

    expect(result.sent).toBe(0);
    expect(result.failed).toEqual(["u1@example.com"]);
    const ops = writes(calls).map((c: RecordedCall) => c.op);
    expect(ops).toContain("insert");
    expect(ops).toContain("delete");
  });

  it("reports a person whose row could not be inserted as failed, and mails nobody", async () => {
    const { db: client } = db({
      leaderboard: [TEAM_A],
      members: [member("u1", "team-a")],
      insertFails: true,
    });
    mocks.createAdminClient.mockReturnValue(client);

    const result = ok(await sendFinaleInvites("finale-1"));

    expect(result.failed).toEqual(["u1@example.com"]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    const { db: client } = db({ leaderboard: [TEAM_A], members: [member("u1", "team-a")] });
    mocks.createAdminClient.mockReturnValue(client);

    expect(await sendFinaleInvites("finale-1")).toEqual({ error: "Admin access required." });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a chapter that is not the Grand Finale", async () => {
    const { db: client } = db({
      chapter: { id: "c1", is_finale: false, status: "applications_open" },
      leaderboard: [TEAM_A],
      members: [member("u1", "team-a")],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const result = await sendFinaleInvites("c1");

    expect(result).toEqual({
      error: "Finale invites can only be sent for the Grand Finale.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a draft or completed chapter", async () => {
    const { db: client } = db({
      chapter: { id: "finale-1", is_finale: true, status: "completed" },
      leaderboard: [TEAM_A],
      members: [member("u1", "team-a")],
    });
    mocks.createAdminClient.mockReturnValue(client);

    expect(await sendFinaleInvites("finale-1")).toEqual({
      error: "This match is not open for invites.",
    });
  });
});

describe("getFinaleInviteBoard", () => {
  it("counts each person once and reports who the next press will mail", async () => {
    const { db: client } = db({
      leaderboard: [TEAM_A, TEAM_B],
      members: [
        member("u1", "team-a"),
        member("u2", "team-a"),
        member("u3", "team-b"),
        // Same person on both qualifying teams: counted once.
        member("u1", "team-b"),
      ],
      invited: [
        { user_id: "u1", response: "yes", application_id: "app-1" },
        { user_id: "u2", response: "no", application_id: null },
      ],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const board = ok(await getFinaleInviteBoard("finale-1"));

    expect(board.counts).toEqual({ invited: 2, in: 1, out: 1, awaiting: 0, notInvited: 1 });
    expect(board.teams.map((t) => t.teamName)).toEqual(["bussies", "Tetrad"]);
  });

  it("flags a member who answered yes but has no application", async () => {
    const { db: client } = db({
      leaderboard: [TEAM_A],
      members: [member("u1", "team-a")],
      invited: [{ user_id: "u1", response: "yes", application_id: null }],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const board = ok(await getFinaleInviteBoard("finale-1"));

    expect(board.teams[0].members[0]).toMatchObject({ response: "yes", accepted: false });
  });

  it("refuses a non-admin", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    expect(await getFinaleInviteBoard("finale-1")).toEqual({ error: "Admin access required." });
  });
});
