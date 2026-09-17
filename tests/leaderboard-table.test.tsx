import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardTable } from "@/components/leaderboard/table";
import type { LeaderboardEntry } from "@/lib/types";

function entry(id: string, name: string, rank: number, totalPoints: number, loyaltyBonus: number): LeaderboardEntry {
  return {
    rank,
    team: {
      id,
      name,
      slug: id,
      logoUrl: null,
      university: null,
      city: null,
      presidentUserId: null,
      lookingForMembers: false,
    },
    totalPoints,
    matchesPlayed: 3,
    bestFinish: null,
    loyaltyBonus,
  };
}

describe("LeaderboardTable loyalty bonus", () => {
  it("labels a team that received a loyalty bonus", () => {
    const html = renderToStaticMarkup(
      <LeaderboardTable entries={[entry("t1", "Team Loyal", 2, 26, 6)]} />
    );
    expect(html).toContain("+6 loyalty");
    expect(html).toContain("Includes a +6 loyalty bonus");
  });

  it("shows no label for a team without a bonus", () => {
    const html = renderToStaticMarkup(
      <LeaderboardTable entries={[entry("t1", "Team Plain", 14, 8, 0)]} />
    );
    expect(html).not.toContain("loyalty");
  });

  it("shows the same rank for tied teams", () => {
    const html = renderToStaticMarkup(
      <LeaderboardTable
        entries={[entry("t1", "Alpha", 14, 8, 0), entry("t2", "Team Plain", 14, 8, 0)]}
      />
    );
    expect(html.match(/>14</g)).toHaveLength(2);
  });
});
