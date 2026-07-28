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

import { sendCertificateEmails } from "@/lib/actions/admin";

const CHAPTER = "chapter-1";
const PLACED_TEAM = "team-placed";
const UNPLACED_TEAM = "team-unplaced";
const PLACED_MEMBER = "member-placed";
const UNPLACED_MEMBER = "member-unplaced";

interface QueryState {
  table: string;
  filters: [string, unknown][];
}

function makeAdminClient({ includeNameless = false } = {}) {
  function resultFor({ table, filters }: QueryState) {
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
      const state: QueryState = { table, filters: [] };
      const resolve = () => Promise.resolve(resultFor(state));
      const builder = {
        select: () => builder,
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
  process.env.NEXT_PUBLIC_SITE_URL = "https://ehl.test";
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
  mocks.createAdminClient.mockReturnValue(makeAdminClient());
  mocks.renderCertificateEmail.mockResolvedValue("<html>certificate email</html>");
  mocks.sendEmail.mockResolvedValue(undefined);
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

    expect(result).toEqual({ success: true, sent: 2, failed: 0 });
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

    expect(result).toEqual({ success: true, sent: 2, failed: 1 });
    expect(mocks.renderCertificateEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("profile email or name is missing")
    );

    consoleError.mockRestore();
  });
});
