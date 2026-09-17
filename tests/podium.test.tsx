import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPodium, MAX_PODIUM_PILLARS } from "@/lib/podium";
import { Podium } from "@/components/leaderboard/podium";
import type { LeaderboardEntry } from "@/lib/types";

function entry(id: string, rank: number, totalPoints = 10): LeaderboardEntry {
  return {
    rank,
    team: {
      id,
      name: `Team ${id}`,
      slug: id,
      logoUrl: null,
      university: null,
      city: null,
      presidentUserId: null,
      lookingForMembers: false,
    },
    totalPoints,
    matchesPlayed: 1,
    bestFinish: null,
    loyaltyBonus: 0,
  };
}

const layout = (ranks: number[]) =>
  buildPodium(ranks.map((r, i) => entry(String.fromCharCode(65 + i), r)));
const shape = (ranks: number[]) => layout(ranks).slots.map((s) => `${s.entry.team.id}${s.rank}`);

describe("buildPodium", () => {
  it("orders distinct places 2nd, 1st, 3rd", () => {
    expect(shape([1, 2, 3, 4])).toEqual(["B2", "A1", "C3"]);
  });

  it("gives every team tied for 3rd its own pillar", () => {
    expect(shape([1, 2, 3, 3, 5])).toEqual(["B2", "A1", "C3", "D3"]);
  });

  it("gives every team tied for 2nd a pillar and keeps 3rd", () => {
    expect(shape([1, 2, 2, 3])).toEqual(["B2", "C2", "A1", "D3"]);
  });

  it("splits tied 2nd places around 1st when there is no 3rd place", () => {
    expect(shape([1, 2, 2, 4])).toEqual(["B2", "A1", "C2"]);
    expect(shape([1, 2, 2, 2, 5])).toEqual(["B2", "C2", "A1", "D2"]);
  });

  it("keeps 3rd place when two teams tie for 1st", () => {
    const l = layout([1, 1, 3, 4]);
    expect(l.slots.map((s) => `${s.entry.team.id}${s.rank}`)).toEqual(["A1", "B1", "C3"]);
    expect(l.tiedForFirst).toBe(2);
  });

  it("keeps input order inside a tie", () => {
    expect(shape([1, 2, 3, 3, 3])).toEqual(["B2", "A1", "C3", "D3", "E3"]);
  });

  it("returns no slots for an empty leaderboard", () => {
    expect(layout([])).toEqual({ slots: [], hiddenCount: 0, tiedForFirst: 0 });
  });

  it("caps pillars and trims the lowest place first", () => {
    const ranks = [1, 2, ...Array(MAX_PODIUM_PILLARS + 2).fill(3)];
    const l = layout(ranks);
    expect(l.slots).toHaveLength(MAX_PODIUM_PILLARS);
    expect(l.hiddenCount).toBe(4); // 1 + 1 + 11 teams, 9 shown
    expect(l.slots.filter((s) => s.rank === 1)).toHaveLength(1);
    expect(l.slots.filter((s) => s.rank === 2)).toHaveLength(1);
  });

  it("counts every team tied for 1st even beyond the cap", () => {
    const l = layout(Array(MAX_PODIUM_PILLARS + 1).fill(1));
    expect(l.slots).toHaveLength(MAX_PODIUM_PILLARS);
    expect(l.hiddenCount).toBe(1);
    expect(l.tiedForFirst).toBe(MAX_PODIUM_PILLARS + 1);
  });
});

describe("Podium", () => {
  it("renders both teams tied for 3rd", () => {
    const html = renderToStaticMarkup(
      <Podium entries={[entry("A", 1, 22), entry("B", 2, 20), entry("C", 3, 16), entry("D", 3, 16), entry("E", 5, 15)]} />
    );
    for (const name of ["Team A", "Team B", "Team C", "Team D"]) expect(html).toContain(name);
    expect(html).not.toContain("Team E");
    expect(html).not.toContain("Tied for 1st");
  });

  it("shows the tied-for-1st banner and the 3rd place below it", () => {
    const html = renderToStaticMarkup(
      <Podium entries={[entry("A", 1, 8), entry("B", 1, 8), entry("C", 3, 7)]} />
    );
    expect(html).toContain("Tied for 1st");
    expect(html).toContain("Team C");
  });

  it("tells the viewer when tied teams did not fit", () => {
    const entries = [entry("A", 1), ...Array.from({ length: MAX_PODIUM_PILLARS + 1 }, (_, i) => entry(`T${i}`, 2))];
    expect(renderToStaticMarkup(<Podium entries={entries} />)).toContain("+2 more tied");
  });
});
