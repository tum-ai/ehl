import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Chapter, Team, TeamMember } from "@/lib/types";
import { toChallenge } from "@/lib/queries/mappers";
import type { TeamMatchHistoryEntry } from "@/lib/queries/teams";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), membership: vi.fn(), chapters: vi.fn(), history: vi.fn(),
  apps: vi.fn(), members: vi.fn(), scores: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: mocks.apps }) }) }),
}));
vi.mock("@/lib/queries", () => ({
  getTeamForUser: mocks.membership,
  getChapters: mocks.chapters,
  getTeamMatchHistory: mocks.history,
  getTeamMembersWithProfiles: mocks.members,
  getPublishedScoresForTeam: mocks.scores,
  getLeaderboard: async () => [],
  getPendingInvitesForTeam: async () => [],
  getDashboardJoinRequestsForTeam: async () => [],
  getUsersLookingForTeam: async () => [],
}));
vi.mock("@/components/dashboard/team-management", () => ({
  TeamManagement: () => <div>Captain team management</div>,
}));
vi.mock("@/components/dashboard/teamless-view", () => ({ TeamlessView: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/components/submission/submission-form", () => ({
  SubmissionForm: () => <h3>Submit Project</h3>,
}));

import Dashboard from "@/app/(participant)/dashboard/page";
import { ChapterSubmissionsOpen } from "@/components/chapter/chapter-submissions-open";

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "current", name: "Current Hackathon", slug: "current-hackathon", city: "Munich",
    country: "Germany", countryCode: "DE", date: "2026-09-22", dateEnd: null,
    status: "submissions_open", description: "", heroImageUrl: null, matchNumber: 2,
    isFinale: false, submissionDeadline: "2026-09-23T18:00:00Z", codeReviewEnabled: false,
    photoAlbumUrl: null, challengeRegistrationEnabled: true, applicationDeadline: null,
    challengeSelectionDeadline: "2026-09-23T12:00:00Z", requireCv: false, requireMotivation: false,
    ...overrides,
  };
}
const team: Team = {
  id: "team", name: "Navigation Team", slug: "navigation-team", logoUrl: null,
  university: null, city: null, presidentUserId: "captain", lookingForMembers: false,
};
function history(event = chapter(), submitted = false): TeamMatchHistoryEntry {
  return {
    chapter: event, challenge: { id: "challenge", title: "Current Challenge" },
    registration: { roster: ["captain", "member"], registeredAt: "2026-09-22T09:00:00Z" },
    submission: submitted ? { projectName: "Saved Project", createdAt: "2026-09-22T10:00:00Z" } : null,
    score: null,
  };
}
function anchors(html: string) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, href, label]) => ({ href, label: label.replace(/<[^>]*>/g, "").trim() }));
}
async function render() { return renderToStaticMarkup(await Dashboard()); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
  mocks.session.mockResolvedValue({ user: { id: "captain" }, profile: { name: "Captain", email: "captain@example.test" } });
  mocks.membership.mockResolvedValue({ team, role: "president" });
  mocks.chapters.mockResolvedValue([chapter()]);
  mocks.history.mockResolvedValue([history()]);
  mocks.apps.mockResolvedValue({ data: [{ chapter_id: "current", status: "checked_in" }] });
  mocks.members.mockResolvedValue([
    { userId: "captain", role: "president", profile: { name: "Captain" } },
    { userId: "member", role: "member", profile: { name: "Member" } },
  ] as TeamMember[]);
  mocks.scores.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

describe("dashboard submission discovery", () => {
  it.each(["president", "member"] as const)("puts a direct submission link before team controls for a %s", async (role) => {
    mocks.membership.mockResolvedValue({ team, role });
    const html = await render();
    expect(anchors(html)).toContainEqual({ href: "/matches/current-hackathon#submission", label: "Submit project" });
    expect(anchors(html)).toContainEqual({ href: "/matches/current-hackathon", label: "Open hackathon" });
    expect(html).toContain("Any team member can submit for the team.");
    const action = html.indexOf("Submit project");
    const controls = html.indexOf(role === "president" ? "Captain team management" : "Team Roster");
    expect(controls).toBeGreaterThan(action);
    expect(html.indexOf("Season overview")).toBeGreaterThan(controls);
  });

  it("offers editing when the team already submitted", async () => {
    mocks.history.mockResolvedValue([history(chapter(), true)]);
    const html = await render();
    expect(anchors(html)).toContainEqual({ href: "/matches/current-hackathon#submission", label: "Edit submission" });
    expect(html).toContain("Saved Project");
    expect(anchors(html).some((a) => a.label === "Submit project")).toBe(false);
  });

  it.each(["hacking", "submissions_open"] as const)("links to the form during %s", async (status) => {
    mocks.chapters.mockResolvedValue([chapter({ status })]);
    expect(anchors(await render())).toContainEqual({ href: "/matches/current-hackathon#submission", label: "Submit project" });
  });

  it.each(["president", "member"] as const)("explains missing registration for a %s without offering a nonexistent form", async (role) => {
    mocks.membership.mockResolvedValue({ team, role });
    mocks.history.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Your team has not selected a challenge.");
    expect(anchors(html).some((a) => a.href.endsWith("#submission"))).toBe(false);
    expect(anchors(html)).toContainEqual({ href: "/matches/current-hackathon", label: "Open hackathon" });
  });

  it.each([["president", "Choose challenge"], ["member", "View challenges"]] as const)("labels challenge selection for a %s", async (role, label) => {
    mocks.membership.mockResolvedValue({ team, role });
    mocks.chapters.mockResolvedValue([chapter({ status: "challenge_selection" })]);
    mocks.history.mockResolvedValue([]);
    expect(anchors(await render())).toContainEqual({ href: "/matches/current-hackathon", label });
  });

  it("does not offer challenge selection after its deadline", async () => {
    mocks.chapters.mockResolvedValue([chapter({ status: "challenge_selection", challengeSelectionDeadline: "2026-09-22T11:00:00Z" })]);
    expect(anchors(await render()).some((a) => a.label === "Choose challenge")).toBe(false);
  });

  it.each(["deadline", "pitching"])("keeps a match link without submission actions after %s", async (reason) => {
    mocks.chapters.mockResolvedValue([chapter(reason === "deadline"
      ? { submissionDeadline: "2026-09-22T12:00:00Z" }
      : { status: "pitching" })]);
    const links = anchors(await render());
    expect(links.some((a) => a.href.endsWith("#submission"))).toBe(false);
    expect(links).toContainEqual({ href: "/matches/current-hackathon", label: "Open hackathon" });
  });

  it("keeps every ongoing attending event discoverable and prioritizes checked in events", async () => {
    const other = chapter({ id: "other", name: "Another Hackathon", slug: "another-hackathon", matchNumber: 1 });
    mocks.chapters.mockResolvedValue([other, chapter()]);
    mocks.apps.mockResolvedValue({ data: [{ chapter_id: "other", status: "accepted" }, { chapter_id: "current", status: "checked_in" }] });
    const html = await render();
    expect(anchors(html)).toContainEqual({ href: "/matches/another-hackathon", label: "Open hackathon" });
    expect(html.indexOf("Current Hackathon")).toBeLessThan(html.indexOf("Another Hackathon"));
  });

  it.each(["accepted", "pending", "waitlisted", "cancelled", "rejected"])("does not offer submission to an applicant with status %s", async (status) => {
    mocks.apps.mockResolvedValue({ data: [{ chapter_id: "current", status }] });
    expect(anchors(await render()).some((a) => a.href.endsWith("#submission"))).toBe(false);
  });

  it("preserves completed match certificate links and upcoming matches", async () => {
    const past = chapter({ id: "past", name: "Past Hackathon", slug: "past-hackathon", status: "completed", matchNumber: 1 });
    const upcoming = chapter({ id: "next", name: "Next Hackathon", slug: "next-hackathon", status: "applications_open", matchNumber: 3 });
    mocks.chapters.mockResolvedValue([past, chapter(), upcoming]);
    mocks.apps.mockResolvedValue({ data: [past, chapter(), upcoming].map((c) => ({ chapter_id: c.id, status: "checked_in" })) });
    mocks.history.mockResolvedValue([history(past), history()]);
    mocks.scores.mockResolvedValue([{ chapterId: "past", placement: 1 }]);
    const links = anchors(await render());
    expect(links.filter((a) => a.href === "/matches/next-hackathon")).toHaveLength(1);
    expect(links.some((a) => a.href === "/api/certificates/past/team?member=captain")).toBe(true);
  });

  it("redirects unauthenticated visitors before loading dashboard data", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(Dashboard()).rejects.toThrow("redirect:/login");
  });
});

describe("submission destination", () => {
  it("provides an anchor with space for the fixed navigation", () => {
    const html = renderToStaticMarkup(<ChapterSubmissionsOpen
      chapter={chapter()} challenges={[toChallenge({ id: "challenge", submission_fields: [] })]}
      teamChallengeId="challenge" teamId="team" userRole="member" submission={null}
    />);
    expect(html).toMatch(/id="submission"[^>]*class="[^"]*scroll-mt-24/);
    expect(html).toContain("Submit Project");
  });
});
