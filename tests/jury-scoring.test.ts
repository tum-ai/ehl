import { describe, it, expect } from "vitest";
import {
  PLACEMENT_POINTS,
  PARTICIPATION_POINTS,
  getPoints,
} from "@/lib/scoring";

/**
 * Tests for the jury scoring logic.
 *
 * The actual submitJuryRanking() function is DB-dependent,
 * but the core calculation (placement -> points) uses getPoints()
 * and PLACEMENT_POINTS. We test the logic that determines
 * what scores get generated from a jury ranking.
 */

describe("Jury Ranking → Score Generation Logic", () => {
  // Simulates the score generation logic from jury.ts submitJuryRanking()
  function simulateScoreGeneration(
    ranking: Record<string, string>, // { "1": teamId, "2": teamId, ... }
    allSubmittedTeamIds: string[]
  ): { teamId: string; placement: number | null; points: number }[] {
    const scores: { teamId: string; placement: number | null; points: number }[] = [];
    const rankedTeamIds = new Set(Object.values(ranking));

    // Ranked teams get placement points
    for (const [place, teamId] of Object.entries(ranking)) {
      const placeNum = parseInt(place);
      const points = PLACEMENT_POINTS[placeNum] || 0;
      scores.push({ teamId, placement: placeNum, points });
    }

    // Unranked teams that submitted get participation points
    for (const teamId of allSubmittedTeamIds) {
      if (!rankedTeamIds.has(teamId)) {
        scores.push({
          teamId,
          placement: null,
          points: PARTICIPATION_POINTS,
        });
      }
    }

    return scores;
  }

  it("generates correct scores for a full top-5 ranking", () => {
    const ranking = {
      "1": "team-a",
      "2": "team-b",
      "3": "team-c",
      "4": "team-d",
      "5": "team-e",
    };
    const allTeams = [
      "team-a", "team-b", "team-c", "team-d", "team-e",
      "team-f", "team-g",
    ];

    const scores = simulateScoreGeneration(ranking, allTeams);

    // Ranked teams
    expect(scores.find((s) => s.teamId === "team-a")).toEqual({
      teamId: "team-a",
      placement: 1,
      points: 8,
    });
    expect(scores.find((s) => s.teamId === "team-b")).toEqual({
      teamId: "team-b",
      placement: 2,
      points: 7,
    });
    expect(scores.find((s) => s.teamId === "team-c")).toEqual({
      teamId: "team-c",
      placement: 3,
      points: 6,
    });
    expect(scores.find((s) => s.teamId === "team-d")).toEqual({
      teamId: "team-d",
      placement: 4,
      points: 4,
    });
    expect(scores.find((s) => s.teamId === "team-e")).toEqual({
      teamId: "team-e",
      placement: 5,
      points: 4,
    });

    // Unranked teams get participation
    expect(scores.find((s) => s.teamId === "team-f")).toEqual({
      teamId: "team-f",
      placement: null,
      points: 2,
    });
    expect(scores.find((s) => s.teamId === "team-g")).toEqual({
      teamId: "team-g",
      placement: null,
      points: 2,
    });

    expect(scores).toHaveLength(7);
  });

  it("handles ranking with fewer than 5 teams", () => {
    const ranking = {
      "1": "team-a",
      "2": "team-b",
      "3": "team-c",
    };
    const allTeams = ["team-a", "team-b", "team-c"];

    const scores = simulateScoreGeneration(ranking, allTeams);

    expect(scores).toHaveLength(3);
    expect(scores[0].points).toBe(8);
    expect(scores[1].points).toBe(7);
    expect(scores[2].points).toBe(6);
    // No participation scores since all are ranked
  });

  it("teams that did not submit get no score at all", () => {
    const ranking = { "1": "team-a" };
    // Only team-a submitted, team-b did not submit so not in allTeams
    const allTeams = ["team-a"];

    const scores = simulateScoreGeneration(ranking, allTeams);
    expect(scores).toHaveLength(1);
    expect(scores[0].points).toBe(8);
  });

  it("all teams submitted but none ranked (empty ranking)", () => {
    const ranking = {};
    const allTeams = ["team-a", "team-b", "team-c"];

    const scores = simulateScoreGeneration(ranking, allTeams);
    expect(scores).toHaveLength(3);
    expect(scores.every((s) => s.points === PARTICIPATION_POINTS)).toBe(true);
    expect(scores.every((s) => s.placement === null)).toBe(true);
  });

  it("ranking with only 1 team", () => {
    const ranking = { "1": "team-a" };
    const allTeams = ["team-a", "team-b"];

    const scores = simulateScoreGeneration(ranking, allTeams);
    expect(scores.find((s) => s.teamId === "team-a")?.points).toBe(8);
    expect(scores.find((s) => s.teamId === "team-b")?.points).toBe(2);
  });

  it("placement beyond 5 gets 0 points (PLACEMENT_POINTS has no entry)", () => {
    const ranking = { "6": "team-x" };
    const allTeams = ["team-x"];

    const scores = simulateScoreGeneration(ranking, allTeams);
    expect(scores[0].points).toBe(0);
    // This is a real edge case: the system allows ranking beyond 5
    // but PLACEMENT_POINTS only maps 1-5
  });

  it("4th and 5th place both get 4 points", () => {
    const ranking = { "4": "team-d", "5": "team-e" };
    const allTeams = ["team-d", "team-e"];

    const scores = simulateScoreGeneration(ranking, allTeams);
    expect(scores[0].points).toBe(4);
    expect(scores[1].points).toBe(4);
  });

  it("total points from a full ranking: 8+7+6+4+4 = 29 for ranked, 2 each for unranked", () => {
    const ranking = {
      "1": "t1",
      "2": "t2",
      "3": "t3",
      "4": "t4",
      "5": "t5",
    };
    const allTeams = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];

    const scores = simulateScoreGeneration(ranking, allTeams);
    const rankedTotal = scores
      .filter((s) => s.placement !== null)
      .reduce((sum, s) => sum + s.points, 0);
    const unrankedTotal = scores
      .filter((s) => s.placement === null)
      .reduce((sum, s) => sum + s.points, 0);

    expect(rankedTotal).toBe(29);
    expect(unrankedTotal).toBe(6); // 3 unranked * 2
    expect(scores).toHaveLength(8);
  });
});

// ─── getPoints edge cases relevant to jury flow ─────────────

describe("getPoints - jury-relevant edge cases", () => {
  it("placement string parsed as integer works correctly", () => {
    // In submitJuryRanking, place comes from Object.entries as a string
    // and is parsed with parseInt()
    const placeStr = "1";
    const placeNum = parseInt(placeStr);
    expect(getPoints(placeNum, true)).toBe(8);
  });

  it("parseInt of non-numeric string returns NaN", () => {
    const placeNum = parseInt("abc");
    expect(isNaN(placeNum)).toBe(true);
    // getPoints with NaN placement: NaN is falsy-ish but truthy
    // NaN && PLACEMENT_POINTS[NaN] → NaN is truthy? Actually NaN is falsy
    // So it falls through to PARTICIPATION_POINTS
    expect(getPoints(NaN, true)).toBe(2);
  });

  it("negative placement falls through to participation", () => {
    expect(getPoints(-1, true)).toBe(2);
  });
});
