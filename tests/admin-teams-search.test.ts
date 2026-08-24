import { describe, it, expect } from "vitest";
import {
  filterTeams,
  filterParticipants,
  teamMatches,
  normalizeQuery,
  type MemberWithProfile,
} from "@/app/admin/(dashboard)/teams/team-search";
import type { Team } from "@/lib/types";
import type { ParticipantWithTeam } from "@/lib/queries/teams";

/**
 * The admin Teams page is how an operator finds one person out of several
 * hundred on an event day. Before this, only the Participants tab had a search
 * box: the Teams tab was an unfiltered wall of rows. A filter that misses a
 * match is indistinguishable from the person not being registered, so the
 * matching rules are pinned here rather than left to the component.
 */

function team(over: Partial<Team> = {}): Team {
  return {
    id: "t1",
    name: "Alpha Innovators",
    slug: "alpha-innovators",
    logoUrl: null,
    university: "TU Munich",
    city: "Munich",
    presidentUserId: "u1",
    lookingForMembers: false,
    ...over,
  };
}

function member(name: string | null, email: string): MemberWithProfile {
  return {
    teamId: "t1",
    userId: `u-${email}`,
    role: "member",
    joinedAt: "2026-08-01T00:00:00Z",
    profile: {
      id: `u-${email}`,
      name,
      email,
      role: "participant",
      lookingForTeam: false,
    } as MemberWithProfile["profile"],
  };
}

function participant(over: Partial<ParticipantWithTeam> = {}): ParticipantWithTeam {
  return {
    id: "p1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    teamId: "t1",
    teamName: "Alpha Innovators",
    teamSlug: "alpha-innovators",
    teamRole: "member",
    checkedIn: false,
    checkedInAt: null,
    ...over,
  };
}

describe("normalizeQuery", () => {
  it("lowercases and trims", () => {
    expect(normalizeQuery("  AdA  ")).toBe("ada");
  });

  it("treats a whitespace-only query as no filter", () => {
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("teamMatches", () => {
  const members = [member("Ada Lovelace", "ada@example.com")];

  it("matches on team name, case-insensitively", () => {
    expect(teamMatches(team(), members, "alpha")).toBe(true);
    expect(teamMatches(team(), members, "ALPHA")).toBe(true);
  });

  it("matches on university", () => {
    expect(teamMatches(team(), members, "tu munich")).toBe(true);
  });

  it("matches on city", () => {
    expect(teamMatches(team(), members, "munich")).toBe(true);
  });

  it("matches on slug", () => {
    expect(teamMatches(team(), members, "alpha-inn")).toBe(true);
  });

  // The reason the Teams tab searches members at all: an operator on the day is
  // holding a person, not a team name.
  it("matches on a member's name", () => {
    expect(teamMatches(team(), members, "lovelace")).toBe(true);
  });

  it("matches on a member's email", () => {
    expect(teamMatches(team(), members, "ada@example")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(teamMatches(team(), members, "zeta")).toBe(false);
  });

  it("survives a member with no profile loaded", () => {
    const orphan: MemberWithProfile = { ...member(null, "x@y.z"), profile: undefined };
    expect(teamMatches(team(), [orphan], "alpha")).toBe(true);
    expect(teamMatches(team(), [orphan], "lovelace")).toBe(false);
  });

  it("survives a team with no university or city", () => {
    const bare = team({ university: null, city: null });
    expect(teamMatches(bare, members, "alpha")).toBe(true);
    expect(teamMatches(bare, members, "munich")).toBe(false);
  });
});

describe("filterTeams", () => {
  const alpha = team();
  const zeta = team({ id: "t2", name: "Zeta Tech", slug: "zeta-tech", university: "ETH", city: "Zurich" });
  const byTeam = new Map<string, MemberWithProfile[]>([
    ["t1", [member("Ada Lovelace", "ada@example.com")]],
    ["t2", [member("Grace Hopper", "grace@example.com")]],
  ]);

  it("returns every team for an empty query", () => {
    expect(filterTeams([alpha, zeta], byTeam, "")).toHaveLength(2);
  });

  it("returns every team for a whitespace-only query", () => {
    expect(filterTeams([alpha, zeta], byTeam, "   ")).toHaveLength(2);
  });

  it("narrows to the team whose MEMBER matches", () => {
    const result = filterTeams([alpha, zeta], byTeam, "grace");
    expect(result.map((t) => t.id)).toEqual(["t2"]);
  });

  it("returns nothing when nothing matches, rather than everything", () => {
    expect(filterTeams([alpha, zeta], byTeam, "nobody")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [alpha, zeta];
    filterTeams(input, byTeam, "alpha");
    expect(input).toHaveLength(2);
  });

  it("handles a team with no members indexed", () => {
    const result = filterTeams([alpha, zeta], new Map(), "alpha");
    expect(result.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("filterParticipants", () => {
  const ada = participant();
  const grace = participant({
    id: "p2",
    name: "Grace Hopper",
    email: "grace@example.com",
    teamName: "Zeta Tech",
  });

  it("returns everyone for an empty query", () => {
    expect(filterParticipants([ada, grace], "")).toHaveLength(2);
  });

  it("matches on name, email, and team name", () => {
    expect(filterParticipants([ada, grace], "hopper").map((p) => p.id)).toEqual(["p2"]);
    expect(filterParticipants([ada, grace], "ada@").map((p) => p.id)).toEqual(["p1"]);
    expect(filterParticipants([ada, grace], "zeta").map((p) => p.id)).toEqual(["p2"]);
  });

  it("survives a participant with no name or team", () => {
    const anon = participant({ id: "p3", name: null, teamName: null, email: "anon@example.com" });
    expect(filterParticipants([anon], "anon").map((p) => p.id)).toEqual(["p3"]);
    expect(filterParticipants([anon], "zeta")).toEqual([]);
  });
});
