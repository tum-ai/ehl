import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  renderCertificateEmail: vi.fn(),
  sendEmail: vi.fn(),
  logEvent: vi.fn(),
  certificateTokenV2: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  requireChapterAdminAction: vi.fn(),
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/emails/render", () => ({
  renderCertificateEmail: mocks.renderCertificateEmail,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/event-log", () => ({
  logEvent: mocks.logEvent,
  logEventStrict: vi.fn(),
}));
vi.mock("@/lib/certificate-token", () => ({
  certificateTokenV2: mocks.certificateTokenV2,
}));

import { sendCertificateEmails, getCertificateSendPreview } from "@/lib/actions/admin";

const CHAPTER = "chapter-1";
const PLACED_TEAM = "team-placed";
const UNPLACED_TEAM = "team-unplaced";
const PLACED_MEMBER = "member-placed";
const UNPLACED_MEMBER = "member-unplaced";

interface QueryState {
  table: string;
  op: "select" | "insert" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
}

/** Every write to certificate_sends, in order, so tests can assert claim/rollback. */
let ledgerWrites: QueryState[] = [];

type CheckIn = { user_id: string | null; email: string | null; existing_team_id?: string | null };

function makeAdminClient({
  includeNameless = false,
  alreadySent = [] as string[],
  claimConflictFor = [] as string[],
  // Who checked in at this chapter. Default: both test members.
  checkedIn = [
    { user_id: PLACED_MEMBER, email: "placed@example.com" },
    { user_id: UNPLACED_MEMBER, email: "participant@example.com" },
  ] as CheckIn[],
  checkInsOverflow = false,
  // The certificate_sends table. Stateful: inserts add a row (or fail with the
  // primary-key error if it exists), deletes remove it. Share one Set between
  // two clients to model two presses against the same database.
  ledger = undefined as Set<string> | undefined,
  ledgerReadFails = false,
  checkInReadFails = false,
  rollbackFails = false,
  // The unplaced member is ALSO on the placed team (rosters carry over).
  unplacedAlsoOnPlacedTeam = false,
} = {}) {
  const rows = ledger ?? new Set(alreadySent);
  function rangeFor(state: QueryState, from: number, to: number) {
    if (state.table === "certificate_sends") {
      if (ledgerReadFails) return { data: null, error: { message: "read failed" } };
      return { data: [...rows].slice(from, to + 1).map((user_id) => ({ user_id })), error: null };
    }
    if (state.table !== "applications") return { data: [], error: null };
    if (checkInReadFails) return { data: null, error: { message: "read failed" } };
    // Overflow: every window comes back full, so the paged read never ends.
    if (checkInsOverflow) {
      return {
        data: Array.from({ length: to - from + 1 }, (_, i) => ({ user_id: `u${from + i}`, email: null })),
        error: null,
      };
    }
    return { data: checkedIn.slice(from, to + 1), error: null };
  }

  function resultFor(state: QueryState) {
    const { table, filters } = state;
    if (table === "certificate_sends") {
      ledgerWrites.push(state);
      if (state.op === "insert") {
        const userId = (state.payload as { user_id: string }).user_id;
        if (claimConflictFor.includes(userId) || rows.has(userId)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        rows.add(userId);
        return { error: null };
      }
      if (state.op === "delete") {
        if (rollbackFails) return { error: { message: "delete failed" } };
        const userId = filters.find(([c]) => c === "user_id")?.[1] as string;
        rows.delete(userId);
      }
      return { error: null };
    }
    const teamId = filters.find(
      ([column]) => column === "team_id" || (table === "teams" && column === "id")
    )?.[1];

    if (table === "chapters") {
      return {
        data: {
          name: "Final Test",
          city: "Paris",
          country: "France",
          date: "2026-06-27",
          date_end: "2026-06-28",
          status: "completed",
        },
      };
    }
    if (table === "scores") {
      return {
        data: [
          {
            team_id: PLACED_TEAM,
            placement: 1,
            points: 8,
            challenge_name: "Challenge A",
            published: true,
          },
          {
            team_id: UNPLACED_TEAM,
            placement: null,
            points: 2,
            challenge_name: "Challenge B",
            published: true,
          },
        ],
      };
    }
    if (table === "team_members" && teamId === PLACED_TEAM) {
      return {
        data: [
          {
            user_id: PLACED_MEMBER,
            profiles: { email: "placed@example.com", name: "Placed Person" },
          },
          ...(unplacedAlsoOnPlacedTeam
            ? [{ user_id: UNPLACED_MEMBER, profiles: { email: "participant@example.com", name: "Participant Person" } }]
            : []),
        ],
      };
    }
    if (table === "team_members" && teamId === UNPLACED_TEAM) {
      return {
        data: [
          {
            user_id: UNPLACED_MEMBER,
            profiles: { email: "participant@example.com", name: "Participant Person" },
          },
          ...(includeNameless
            ? [
                {
                  user_id: "member-without-name",
                  profiles: { email: "nameless@example.com", name: null },
                },
              ]
            : []),
        ],
      };
    }
    if (table === "teams" && teamId === PLACED_TEAM) {
      return { data: { name: "Placed Team" } };
    }
    if (table === "teams" && teamId === UNPLACED_TEAM) {
      return { data: { name: "Participant Team" } };
    }
    return { data: null, error: null };
  }

  return {
    from(table: string) {
      const state: QueryState = { table, op: "select", filters: [] };
      const resolve = () => Promise.resolve(resultFor(state));
      const builder = {
        select: () => builder,
        insert: (payload: unknown) => {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        delete: () => {
          state.op = "delete";
          return builder;
        },
        order: () => builder,
        range: (from: number, to: number) => Promise.resolve(rangeFor(state, from, to)),
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return builder;
        },
        single: resolve,
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => resolve().then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ledgerWrites = [];
  process.env.NEXT_PUBLIC_SITE_URL = "https://ehl.test";
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
  mocks.createAdminClient.mockReturnValue(makeAdminClient());
  mocks.renderCertificateEmail.mockResolvedValue("<html>certificate email</html>");
  // sendEmail resolves true once the transport accepted the message.
  mocks.sendEmail.mockResolvedValue(true);
  mocks.certificateTokenV2.mockImplementation(
    (
      _chapterId: string,
      _teamId: string,
      scope: { variant: string; memberId?: string | null }
    ) => `${scope.variant}-${scope.memberId ?? "team"}-token`
  );
});

describe("sendCertificateEmails", () => {
  it("rejects non-admin callers before reading certificate data", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");

    await expect(sendCertificateEmails(CHAPTER)).resolves.toEqual({
      error: "Admin access required.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends only personal certificate links and scopes participation to each member", async () => {
    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 2, failed: 0, remaining: 0, alreadySent: 0, stuck: 0 });
    expect(mocks.renderCertificateEmail).toHaveBeenCalledTimes(2);

    const payloads = mocks.renderCertificateEmail.mock.calls.map(([payload]) => payload);
    const placed = payloads.find((payload) => payload.memberName === "Placed Person");
    const unplaced = payloads.find(
      (payload) => payload.memberName === "Participant Person"
    );

    expect(placed).toMatchObject({
      personalCertificateUrl:
        `https://ehl.test/api/certificates/${CHAPTER}/${PLACED_TEAM}` +
        `?variant=achievement&member=${PLACED_MEMBER}` +
        `&token=achievement-${PLACED_MEMBER}-token`,
      participationCertificateUrl:
        `https://ehl.test/api/certificates/${CHAPTER}/${PLACED_TEAM}` +
        `?variant=participation&member=${PLACED_MEMBER}` +
        `&token=participation-${PLACED_MEMBER}-token`,
    });
    expect(placed).not.toHaveProperty("teamCertificateUrl");

    expect(unplaced).toMatchObject({
      personalCertificateUrl:
        `https://ehl.test/api/certificates/${CHAPTER}/${UNPLACED_TEAM}` +
        `?variant=participation&member=${UNPLACED_MEMBER}` +
        `&token=participation-${UNPLACED_MEMBER}-token`,
      participationCertificateUrl: null,
    });
    expect(unplaced).not.toHaveProperty("teamCertificateUrl");
  });

  it("reports a member without a printable profile name instead of sending an empty email", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ includeNameless: true }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 2, failed: 1, remaining: 0, alreadySent: 0, stuck: 0 });
    expect(mocks.renderCertificateEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("profile email or name is missing")
    );

    consoleError.mockRestore();
  });
});

// Idempotence (migration 00073), built like sendRsvpEmails: a certificate_sends
// row is claimed BEFORE each email and removed if the send fails, so a second
// press only reaches members the first one did not.
describe("sendCertificateEmails: each member is mailed once", () => {
  it("skips members who already received theirs and mails only the rest", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ alreadySent: [PLACED_MEMBER] }));

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 1, failed: 0, remaining: 0, alreadySent: 1, stuck: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "participant@example.com" })
    );
  });

  it("claims a record for every member before mailing them", async () => {
    await sendCertificateEmails(CHAPTER);

    const claims = ledgerWrites.filter((w) => w.op === "insert").map((w) => w.payload);
    expect(claims).toEqual(
      expect.arrayContaining([
        { chapter_id: CHAPTER, user_id: PLACED_MEMBER, team_id: PLACED_TEAM },
        { chapter_id: CHAPTER, user_id: UNPLACED_MEMBER, team_id: UNPLACED_TEAM },
      ])
    );
    expect(claims).toHaveLength(2);
    expect(ledgerWrites.some((w) => w.op === "delete")).toBe(false);
  });

  it("does not mail a member a concurrent press already claimed", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ claimConflictFor: [PLACED_MEMBER] }));

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 1, failed: 0, remaining: 0, alreadySent: 0, stuck: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "placed@example.com" })
    );
  });

  it("removes the record when the email fails, so the next press retries that member", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "participant@example.com") throw new Error("smtp timeout");
      return true;
    });

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 1, failed: 1, remaining: 0, alreadySent: 0, stuck: 0 });
    const rollbacks = ledgerWrites.filter((w) => w.op === "delete");
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].filters).toEqual([
      ["chapter_id", CHAPTER],
      ["user_id", UNPLACED_MEMBER],
    ]);
    consoleError.mockRestore();
  });

  it("records already-sent and remaining counts in the audit log", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ alreadySent: [PLACED_MEMBER] }));

    await sendCertificateEmails(CHAPTER);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chapter.certificates_sent",
        delta: { created: { sent: 1, failed: 0, remaining: 0, already_sent: 1, not_checked_in: 0 } },
      })
    );
  });
});

describe("getCertificateSendPreview", () => {
  it("reports exactly the members a press would mail, without sending", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ alreadySent: [PLACED_MEMBER], includeNameless: true })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const preview = await getCertificateSendPreview(CHAPTER);

    expect(preview).toEqual({ teams: 2, recipients: 1, alreadySent: 1, missingProfile: 1, notCheckedIn: 0 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(ledgerWrites).toHaveLength(0);
    consoleError.mockRestore();
  });

  it("rejects non-admin callers", async () => {
    mocks.requireAdminAction.mockResolvedValue("Admin access required.");
    await expect(getCertificateSendPreview(CHAPTER)).resolves.toEqual({
      error: "Admin access required.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

// Rosters carry over between chapters, so "current member of a scored team"
// also matches people who joined later and never attended. Only members who
// CHECKED IN at the chapter get a certificate.
describe("sendCertificateEmails: only members who checked in at the chapter", () => {
  it("skips a team member who did not check in, and reports them", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({ checkedIn: [{ user_id: PLACED_MEMBER, email: "placed@example.com" }] })
    );

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 1, failed: 0, remaining: 0, alreadySent: 0, stuck: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "placed@example.com" }));
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: { created: { sent: 1, failed: 0, remaining: 0, already_sent: 0, not_checked_in: 1 } },
      })
    );
  });

  it("recognises a check-in by email when the application is not linked to an account", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        checkedIn: [
          { user_id: null, email: "Placed@Example.com" },
          { user_id: UNPLACED_MEMBER, email: "participant@example.com" },
        ],
      })
    );

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 2, failed: 0, remaining: 0, alreadySent: 0, stuck: 0 });
  });

  it("refuses rather than guessing when the check-in list is cut off", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ checkInsOverflow: true }));

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({
      error: "Could not load this match's check-ins completely. Nothing was sent.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(ledgerWrites).toHaveLength(0);
  });

  it("counts members who did not check in in the preview", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ checkedIn: [] }));

    const preview = await getCertificateSendPreview(CHAPTER);

    expect(preview).toEqual({ teams: 2, recipients: 0, alreadySent: 0, missingProfile: 0, notCheckedIn: 2 });
  });
});

// Review follow-ups: the claim must exist BEFORE the email goes out, a failure
// must be retried by the next press, two presses must not double-mail, and any
// read the decision depends on must be complete.
describe("sendCertificateEmails: claim, retry and concurrency", () => {
  it("records the member before their email is sent", async () => {
    const recordedAtSend: boolean[] = [];
    const ledger = new Set<string>();
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ ledger }));
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      const member = to === "placed@example.com" ? PLACED_MEMBER : UNPLACED_MEMBER;
      recordedAtSend.push(ledger.has(member));
      return true;
    });

    await sendCertificateEmails(CHAPTER);

    expect(recordedAtSend).toEqual([true, true]);
  });

  it("retries a failed member on the next press, and mails nobody twice", async () => {
    const ledger = new Set<string>();
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ ledger }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "participant@example.com") throw new Error("smtp timeout");
      return true;
    });
    const first = await sendCertificateEmails(CHAPTER);
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    expect([...ledger]).toEqual([PLACED_MEMBER]);

    mocks.sendEmail.mockReset();
    mocks.sendEmail.mockResolvedValue(true);
    const second = await sendCertificateEmails(CHAPTER);

    expect(second).toEqual({ success: true, sent: 1, failed: 0, remaining: 0, alreadySent: 1, stuck: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "participant@example.com" }));
    consoleError.mockRestore();
  });

  it("two presses at the same time mail each member exactly once", async () => {
    const ledger = new Set<string>();
    mocks.createAdminClient.mockImplementation(() => makeAdminClient({ ledger }));

    const [a, b] = await Promise.all([sendCertificateEmails(CHAPTER), sendCertificateEmails(CHAPTER)]);

    const recipients = mocks.sendEmail.mock.calls.map(([arg]) => (arg as { to: string }).to).sort();
    expect(recipients).toEqual(["participant@example.com", "placed@example.com"]);
    expect(((a as { sent: number }).sent ?? 0) + ((b as { sent: number }).sent ?? 0)).toBe(2);
  });

  it("treats a skipped email (SMTP not configured) as failed and keeps the member pending", async () => {
    const ledger = new Set<string>();
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ ledger }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockResolvedValue(false);

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 0, failed: 2, remaining: 0, alreadySent: 0, stuck: 0 });
    expect(ledger.size).toBe(0);
    consoleError.mockRestore();
  });

  it("reports a member whose failed send could not be rolled back", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ rollbackFails: true }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "participant@example.com") throw new Error("smtp timeout");
      return true;
    });

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 1, failed: 1, remaining: 0, alreadySent: 0, stuck: 1 });
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: {
          created: {
            sent: 1, failed: 1, remaining: 0, already_sent: 0, not_checked_in: 0,
            stuck_user_ids: [UNPLACED_MEMBER],
          },
        },
      })
    );
    consoleError.mockRestore();
  });

  it("does not record anyone when the certificate links cannot be built", async () => {
    const ledger = new Set<string>();
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ ledger }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.certificateTokenV2.mockImplementation(() => {
      throw new Error("CERTIFICATE_LINK_SECRET is required");
    });

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toEqual({ success: true, sent: 0, failed: 2, remaining: 0, alreadySent: 0, stuck: 0 });
    expect(ledgerWrites.filter((w) => w.op === "insert")).toHaveLength(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("sendCertificateEmails: incomplete reads refuse instead of guessing", () => {
  it("refuses when the record of past sends cannot be read", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ ledgerReadFails: true }));
    await expect(sendCertificateEmails(CHAPTER)).resolves.toEqual({
      error: "Could not load who already received a certificate. Nothing was sent.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses when the check-ins cannot be read, instead of treating everyone as absent", async () => {
    mocks.createAdminClient.mockReturnValue(makeAdminClient({ checkInReadFails: true }));
    await expect(getCertificateSendPreview(CHAPTER)).resolves.toEqual({
      error: "Could not load this match's check-ins completely. Nothing was sent.",
    });
  });
});

describe("sendCertificateEmails: attendance identity", () => {
  it("does not match by email when the application is linked to a different account", async () => {
    // The application belongs to another account; its stale email now matches
    // the placed member's profile. Only the account link counts.
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        checkedIn: [
          { user_id: "someone-else", email: "placed@example.com" },
          { user_id: UNPLACED_MEMBER, email: "participant@example.com" },
        ],
      })
    );

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toMatchObject({ sent: 1 });
    expect(mocks.sendEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: "placed@example.com" }));
  });

  it("mails a member on two scored teams once, for the team they checked in with", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeAdminClient({
        unplacedAlsoOnPlacedTeam: true,
        checkedIn: [
          { user_id: PLACED_MEMBER, email: "placed@example.com", existing_team_id: PLACED_TEAM },
          { user_id: UNPLACED_MEMBER, email: "participant@example.com", existing_team_id: UNPLACED_TEAM },
        ],
      })
    );

    const result = await sendCertificateEmails(CHAPTER);

    expect(result).toMatchObject({ sent: 2 });
    const toParticipant = mocks.sendEmail.mock.calls.filter(
      ([arg]) => (arg as { to: string }).to === "participant@example.com"
    );
    expect(toParticipant).toHaveLength(1);
    const payload = mocks.renderCertificateEmail.mock.calls
      .map(([p]) => p)
      .find((p) => p.memberName === "Participant Person");
    expect(payload).toMatchObject({ teamName: "Participant Team" });
  });
});
