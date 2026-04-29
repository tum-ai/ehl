import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = vi.fn<any>();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock("@/lib/config/limits", () => ({
  QUERY_LIMITS: {
    adminStatsApplications: 10000,
    challengeRegistrations: 500,
    applicationsPerChapter: 2000,
    submissionsPerChallenge: 200,
  },
}));

import { getSeasonStats, getChapterDetailStats } from "@/lib/queries/admin-stats";

// ─── Mock chain builder ──────────────────────────────────

function chain(data: unknown) {
  const obj: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  // Terminal: resolve with { data }
  // For Supabase, queries are thenable, so we resolve on chain end
  // We make every method return the chain, and the chain itself resolves to { data }
  const proxy = new Proxy(obj, {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve({ data });
      }
      const val = target[prop as string];
      if (typeof val === "function") {
        return (...args: unknown[]) => {
          (val as Function)(...args);
          return proxy;
        };
      }
      return val;
    },
  });
  return proxy;
}

// ─── getSeasonStats ──────────────────────────────────────

describe("getSeasonStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct aggregates for a typical season", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      switch (table) {
        case "chapters":
          return chain([
            { id: "ch1", name: "Munich", match_number: 1, status: "completed" },
            { id: "ch2", name: "Berlin", match_number: 2, status: "submissions_open" },
          ]);
        case "applications":
          return chain([
            { chapter_id: "ch1", status: "checked_in" },
            { chapter_id: "ch1", status: "checked_in" },
            { chapter_id: "ch1", status: "rejected" },
            { chapter_id: "ch2", status: "accepted" },
            { chapter_id: "ch2", status: "checked_in" },
            { chapter_id: "ch2", status: "pending" },
          ]);
        case "challenge_registrations":
          return chain([
            { chapter_id: "ch1", team_id: "t1" },
            { chapter_id: "ch2", team_id: "t2" },
          ]);
        case "submissions":
          return chain([
            { challenge_id: "c1", team_id: "t1" },
            { challenge_id: "c2", team_id: "t2" },
          ]);
        case "challenges":
          return chain([
            { id: "c1", chapter_id: "ch1" },
            { id: "c2", chapter_id: "ch2" },
          ]);
        default:
          return chain([]);
      }
    });

    const stats = await getSeasonStats();

    // 3 checked_in applications total
    expect(stats.totalParticipants).toBe(3);
    expect(stats.totalSubmissions).toBe(2);
    expect(stats.totalRegistrations).toBe(2);

    // Funnel
    expect(stats.applicationFunnel.applied).toBe(6);
    // accepted includes both "accepted" and "checked_in" statuses
    expect(stats.applicationFunnel.accepted).toBe(4); // 2 checked_in ch1 + 1 accepted ch2 + 1 checked_in ch2
    expect(stats.applicationFunnel.checkedIn).toBe(3);
    expect(stats.applicationFunnel.submitted).toBe(2); // 2 unique teams

    // Season progression
    expect(stats.seasonProgression.completed).toBe(1);
    expect(stats.seasonProgression.total).toBe(2);

    // Per-chapter
    expect(stats.perChapter).toHaveLength(2);

    const munich = stats.perChapter.find((c) => c.chapterName === "Munich")!;
    expect(munich.applied).toBe(3);
    expect(munich.checkedIn).toBe(2);
    expect(munich.registrations).toBe(1);
    expect(munich.submissions).toBe(1);

    const berlin = stats.perChapter.find((c) => c.chapterName === "Berlin")!;
    expect(berlin.applied).toBe(3);
    expect(berlin.checkedIn).toBe(1);
    expect(berlin.registrations).toBe(1);
    expect(berlin.submissions).toBe(1);
  });

  it("handles empty season with no data", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation(() => chain([]));

    const stats = await getSeasonStats();

    expect(stats.totalParticipants).toBe(0);
    expect(stats.totalSubmissions).toBe(0);
    expect(stats.totalRegistrations).toBe(0);
    expect(stats.applicationFunnel.applied).toBe(0);
    expect(stats.applicationFunnel.submitted).toBe(0);
    expect(stats.seasonProgression.completed).toBe(0);
    expect(stats.seasonProgression.total).toBe(0);
    expect(stats.perChapter).toHaveLength(0);
  });

  it("handles null data from Supabase gracefully", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation(() => chain(null));

    const stats = await getSeasonStats();

    expect(stats.totalParticipants).toBe(0);
    expect(stats.totalSubmissions).toBe(0);
    expect(stats.perChapter).toHaveLength(0);
  });

  it("counts same team submitting to multiple challenges correctly", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      switch (table) {
        case "chapters":
          return chain([{ id: "ch1", name: "Munich", match_number: 1, status: "completed" }]);
        case "applications":
          return chain([]);
        case "challenge_registrations":
          return chain([]);
        case "submissions":
          // Same team submitted to 2 different challenges
          return chain([
            { challenge_id: "c1", team_id: "t1" },
            { challenge_id: "c2", team_id: "t1" },
          ]);
        case "challenges":
          return chain([
            { id: "c1", chapter_id: "ch1" },
            { id: "c2", chapter_id: "ch1" },
          ]);
        default:
          return chain([]);
      }
    });

    const stats = await getSeasonStats();

    expect(stats.totalSubmissions).toBe(2); // 2 submission records
    expect(stats.applicationFunnel.submitted).toBe(1); // but only 1 unique team
  });
});

// ─── getChapterDetailStats ───────────────────────────────

describe("getChapterDetailStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct per-chapter detail stats", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      switch (table) {
        case "applications":
          return chain([
            { status: "pending" },
            { status: "accepted" },
            { status: "accepted" },
            { status: "checked_in" },
            { status: "checked_in" },
            { status: "checked_in" },
            { status: "rejected" },
            { status: "waitlisted" },
          ]);
        case "challenges":
          return chain([
            { id: "c1", title: "AI Challenge", sponsor_name: "OpenAI" },
            { id: "c2", title: "Web Challenge", sponsor_name: null },
          ]);
        case "challenge_registrations":
          return chain([
            { challenge_id: "c1", team_id: "t1" },
            { challenge_id: "c1", team_id: "t2" },
            { challenge_id: "c2", team_id: "t3" },
          ]);
        case "submissions":
          return chain([
            { challenge_id: "c1", team_id: "t1" },
            { challenge_id: "c2", team_id: "t3" },
          ]);
        case "jury_assignments":
          return chain([
            { challenge_id: "c1", user_id: "j1" },
            { challenge_id: "c1", user_id: "j2" },
            { challenge_id: "c2", user_id: "j1" },
          ]);
        case "jury_rankings":
          return chain([
            { challenge_id: "c1", jury_user_id: "j1" },
            // j2 hasn't voted yet for c1
          ]);
        default:
          return chain([]);
      }
    });

    const stats = await getChapterDetailStats("ch1");

    // Application counts
    expect(stats.applications.total).toBe(8);
    expect(stats.applications.pending).toBe(1);
    expect(stats.applications.accepted).toBe(2);
    expect(stats.applications.checkedIn).toBe(3);
    expect(stats.applications.rejected).toBe(1);
    expect(stats.applications.waitlisted).toBe(1);

    // Totals
    expect(stats.totals.registeredTeams).toBe(3);
    expect(stats.totals.submittedTeams).toBe(2);
    expect(stats.totals.checkedInParticipants).toBe(3);

    // Challenge breakdown
    expect(stats.challenges).toHaveLength(2);

    const ai = stats.challenges.find((c) => c.title === "AI Challenge")!;
    expect(ai.sponsorName).toBe("OpenAI");
    expect(ai.registrations).toBe(2);
    expect(ai.submissions).toBe(1);
    expect(ai.juryAssigned).toBe(2);
    expect(ai.juryVoted).toBe(1);

    const web = stats.challenges.find((c) => c.title === "Web Challenge")!;
    expect(web.sponsorName).toBeNull();
    expect(web.registrations).toBe(1);
    expect(web.submissions).toBe(1);
    expect(web.juryAssigned).toBe(1);
    expect(web.juryVoted).toBe(0);
  });

  it("handles chapter with no challenges", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      switch (table) {
        case "applications":
          return chain([{ status: "pending" }, { status: "pending" }]);
        case "challenges":
          return chain([]);
        case "challenge_registrations":
          return chain([]);
        default:
          return chain([]);
      }
    });

    const stats = await getChapterDetailStats("ch1");

    expect(stats.applications.total).toBe(2);
    expect(stats.challenges).toHaveLength(0);
    expect(stats.totals.registeredTeams).toBe(0);
    expect(stats.totals.submittedTeams).toBe(0);
  });

  it("handles chapter with no applications", async () => {
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation(() => chain([]));

    const stats = await getChapterDetailStats("ch1");

    expect(stats.applications.total).toBe(0);
    expect(stats.applications.pending).toBe(0);
    expect(stats.applications.checkedIn).toBe(0);
  });
});
