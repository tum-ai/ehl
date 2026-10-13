import { describe, it, expect } from "vitest";
import { buildShowcaseTeams, type ShowcaseTeamInputs } from "@/lib/showcase-shared";

// The showcase Teams view pairs each registered team with the people who played
// on it and the project it submitted. It must never widen the consent gate: a
// roster member without sponsor consent is counted, never named.

type Member = { id: string; name: string };

const CHALLENGE_A = {
  id: "ch-a",
  title: "Climate",
  submissionFields: [
    { key: "repo", label: "GitHub Repository", type: "repo" },
    { key: "demo", label: "Demo", type: "url" },
    { key: "deck", label: "Pitch Deck", type: "file" },
    { key: "notes", label: "Notes for the jury", type: "text" },
  ],
};
const CHALLENGE_B = { id: "ch-b", title: "Health", submissionFields: [{ key: "demo", label: "Demo", type: "url" }] };

function inputs(overrides: Partial<ShowcaseTeamInputs<Member>> = {}): ShowcaseTeamInputs<Member> {
  return {
    registrations: [
      { teamId: "t1", teamName: "Alpha", challengeId: "ch-a", roster: ["u1", "u2", "u3"] },
    ],
    challenges: [CHALLENGE_A, CHALLENGE_B],
    profiles: [
      { id: "u1", email: "Ada@Example.com" },
      { id: "u2", email: "bob@example.com" },
      { id: "u3", email: null },
    ],
    // Only Ada consented.
    memberByEmail: new Map([["ada@example.com", { id: "app-ada", name: "Ada" }]]),
    submissions: [
      {
        teamId: "t1",
        challengeId: "ch-a",
        projectName: "Carbon Lens",
        shortDescription: "Tracks emissions",
        techStack: ["Next.js", 42, "Python"],
        fields: {
          repo: "https://github.com/alpha/carbon-lens",
          demo: "javascript:alert(1)",
          deck: "https://drive.google.com/file/d/secret/view",
          notes: "private remark for the jury",
        },
      },
    ],
    ranking: [],
    ...overrides,
  };
}

describe("buildShowcaseTeams", () => {
  it("names consented members and only counts the rest", () => {
    const [team] = buildShowcaseTeams(inputs());
    expect(team.members).toEqual([{ id: "app-ada", name: "Ada" }]);
    expect(team.hiddenMemberCount).toBe(2);
  });

  it("pairs the team with its submission for that challenge", () => {
    const [team] = buildShowcaseTeams(inputs());
    expect(team.teamName).toBe("Alpha");
    expect(team.challengeName).toBe("Climate");
    expect(team.submission).toEqual({
      projectName: "Carbon Lens",
      shortDescription: "Tracks emissions",
      techStack: ["Next.js", "Python"],
      links: [{ label: "GitHub Repository", url: "https://github.com/alpha/carbon-lens" }],
    });
  });

  it("leaves out file and text fields and non-http links", () => {
    const [team] = buildShowcaseTeams(inputs());
    const urls = team.submission!.links.map((l) => l.url).join(" ");
    expect(urls).not.toContain("drive.google.com");
    expect(urls).not.toContain("javascript:");
    expect(JSON.stringify(team.submission)).not.toContain("private remark");
  });

  it("does not pair a submission made for a different challenge", () => {
    const [team] = buildShowcaseTeams(
      inputs({
        registrations: [{ teamId: "t1", teamName: "Alpha", challengeId: "ch-b", roster: [] }],
      })
    );
    expect(team.submission).toBeNull();
    expect(team.challengeName).toBe("Health");
  });

  it("attaches the published placement of that team and challenge", () => {
    const [team] = buildShowcaseTeams(
      inputs({
        ranking: [
          { teamId: "t1", challengeId: "ch-b", placement: 1, points: 8 },
          { teamId: "t1", challengeId: "ch-a", placement: 2, points: 7 },
        ],
      })
    );
    expect(team.placement).toBe(2);
    expect(team.points).toBe(7);
  });

  it("orders placed teams first, then teams with a project, then by name", () => {
    const teams = buildShowcaseTeams(
      inputs({
        registrations: [
          { teamId: "t3", teamName: "Zeta", challengeId: "ch-a", roster: [] },
          { teamId: "t2", teamName: "Beta", challengeId: "ch-a", roster: [] },
          { teamId: "t4", teamName: "Gamma", challengeId: "ch-a", roster: [] },
          { teamId: "t1", teamName: "Alpha", challengeId: "ch-a", roster: [] },
        ],
        submissions: [
          { teamId: "t3", challengeId: "ch-a", projectName: "Z", shortDescription: null, techStack: [], fields: {} },
          { teamId: "t1", challengeId: "ch-a", projectName: "A", shortDescription: null, techStack: [], fields: {} },
        ],
        ranking: [{ teamId: "t4", challengeId: "ch-a", placement: 1, points: 8 }],
      })
    );
    expect(teams.map((t) => t.teamName)).toEqual(["Gamma", "Alpha", "Zeta", "Beta"]);
  });

  it("counts a duplicated roster id once", () => {
    const [team] = buildShowcaseTeams(
      inputs({
        registrations: [{ teamId: "t1", teamName: "Alpha", challengeId: "ch-a", roster: ["u1", "u1"] }],
      })
    );
    expect(team.members).toHaveLength(1);
    expect(team.hiddenMemberCount).toBe(0);
  });
});
