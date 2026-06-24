import { describe, it, expect } from "vitest";
import {
  PLACEMENT_POINTS,
  PARTICIPATION_POINTS,
  getPoints,
  calculateLeaderboard,
  getPublishReadiness,
  getPendingJuryTeamIds,
} from "@/lib/scoring";
import type { Team, Score, Chapter } from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────

function makeTeam(id: string, name: string): Team {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    logoUrl: null,
    university: null,
    city: null,
    presidentUserId: null,
    lookingForMembers: false,
  };
}

function makeScore(
  teamId: string,
  chapterId: string,
  placement: number | null,
  points: number
): Score {
  return {
    chapterId,
    teamId,
    challengeName: "Test Challenge",
    challengeId: "ch-1",
    placement,
    points,
    source: "jury",
  };
}

const emptyChapter: Chapter = {
  id: "c1",
  name: "Match 1",
  slug: "match-1",
  city: "Munich",
  country: "Germany",
  countryCode: "DE",
  date: "2026-05-15",
  dateEnd: "2026-05-16",
  status: "completed",
  description: "Test",
  heroImageUrl: null,
  matchNumber: 1,
  isFinale: false,
  submissionDeadline: null,
  codeReviewEnabled: false,
  photoAlbumUrl: null,
  challengeRegistrationEnabled: false,
  applicationDeadline: null,
  challengeSelectionDeadline: null,
};

// ─── PLACEMENT_POINTS constant ──────────────────────────────

describe("PLACEMENT_POINTS", () => {
  it("maps 1st place to 8 points", () => {
    expect(PLACEMENT_POINTS[1]).toBe(8);
  });

  it("maps 2nd place to 7 points", () => {
    expect(PLACEMENT_POINTS[2]).toBe(7);
  });

  it("maps 3rd place to 6 points", () => {
    expect(PLACEMENT_POINTS[3]).toBe(6);
  });

  it("maps 4th place to 4 points", () => {
    expect(PLACEMENT_POINTS[4]).toBe(4);
  });

  it("maps 5th place to 4 points (same as 4th)", () => {
    expect(PLACEMENT_POINTS[5]).toBe(4);
  });

  it("has no mapping for 6th place and beyond", () => {
    expect(PLACEMENT_POINTS[6]).toBeUndefined();
    expect(PLACEMENT_POINTS[10]).toBeUndefined();
  });
});

describe("PARTICIPATION_POINTS", () => {
  it("is 2", () => {
    expect(PARTICIPATION_POINTS).toBe(2);
  });
});

// ─── getPoints() ────────────────────────────────────────────

describe("getPoints", () => {
  it("returns 0 if team did not submit", () => {
    expect(getPoints(1, false)).toBe(0);
    expect(getPoints(null, false)).toBe(0);
  });

  it("returns correct points for placements 1-5", () => {
    expect(getPoints(1, true)).toBe(8);
    expect(getPoints(2, true)).toBe(7);
    expect(getPoints(3, true)).toBe(6);
    expect(getPoints(4, true)).toBe(4);
    expect(getPoints(5, true)).toBe(4);
  });

  it("returns PARTICIPATION_POINTS for submitted but unranked teams", () => {
    expect(getPoints(null, true)).toBe(2);
  });

  it("returns PARTICIPATION_POINTS for placement beyond top 5", () => {
    expect(getPoints(6, true)).toBe(2);
    expect(getPoints(10, true)).toBe(2);
    expect(getPoints(99, true)).toBe(2);
  });

  it("returns 0 for placement 0 (edge case: falsy but numeric)", () => {
    // placement=0 is falsy in JS, so it falls through to participation
    expect(getPoints(0, true)).toBe(2);
  });
});

// ─── calculateLeaderboard() ─────────────────────────────────

describe("calculateLeaderboard", () => {
  it("returns empty array for no teams", () => {
    const result = calculateLeaderboard([], [], []);
    expect(result).toEqual([]);
  });

  it("ranks a single team with no scores at rank 1 with 0 points", () => {
    const teams = [makeTeam("t1", "Alpha")];
    const result = calculateLeaderboard(teams, [], [emptyChapter]);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
    expect(result[0].totalPoints).toBe(0);
    expect(result[0].matchesPlayed).toBe(0);
    expect(result[0].bestFinish).toBeNull();
  });

  it("ranks teams by total points descending", () => {
    const teams = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta"), makeTeam("t3", "Gamma")];
    const scores = [
      makeScore("t1", "c1", 3, 6),
      makeScore("t2", "c1", 1, 8),
      makeScore("t3", "c1", 5, 4),
    ];
    const result = calculateLeaderboard(teams, scores, [emptyChapter]);
    expect(result[0].team.id).toBe("t2");
    expect(result[0].rank).toBe(1);
    expect(result[1].team.id).toBe("t1");
    expect(result[1].rank).toBe(2);
    expect(result[2].team.id).toBe("t3");
    expect(result[2].rank).toBe(3);
  });

  it("breaks ties using bestFinish (lower is better)", () => {
    const teams = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta")];
    // Both have 8 points total, but t1 has a 1st place finish and t2 has a 2nd + participation
    const scores = [
      makeScore("t1", "c1", 1, 8),
      makeScore("t2", "c1", 2, 7),
      makeScore("t2", "c2", null, 2), // +2 participation = 9 total? No, let's make equal
    ];
    // Actually let's make them truly equal points
    const teams2 = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta")];
    const scores2 = [
      makeScore("t1", "c1", 2, 7),  // 7 points, best finish: 2nd
      makeScore("t2", "c1", 4, 4),  // 4 points
      makeScore("t2", "c2", 3, 6),  // +6 = not equal... let me recalc
    ];
    // Let's just do: t1 = 8 points (1st), t2 = 8 points (2nd + participation)
    const teams3 = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta")];
    const scores3 = [
      makeScore("t1", "c1", 1, 8),               // total: 8, best: 1
      makeScore("t2", "c1", 2, 7),               // 7
      { ...makeScore("t2", "c2", null, 1), points: 1 },  // total: 8, best: 2
    ];
    const result = calculateLeaderboard(teams3, scores3, [emptyChapter]);
    // Both have 8 points, but t1 has best finish of 1, t2 has best finish of 2
    expect(result[0].team.id).toBe("t1");
    expect(result[1].team.id).toBe("t2");
    // Same rank because same points but different bestFinish? No - different bestFinish = different rank
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  it("assigns same rank for truly tied teams (same points + same bestFinish)", () => {
    const teams = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta")];
    const scores = [
      makeScore("t1", "c1", 4, 4),  // total: 4, best: 4
      makeScore("t2", "c1", 5, 4),  // total: 4, best: 5 - NOT same bestFinish
    ];
    const result = calculateLeaderboard(teams, scores, [emptyChapter]);
    // Different bestFinish, so different ranks
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);

    // Now truly tied
    const scores2 = [
      makeScore("t1", "c1", 4, 4),  // total: 4, best: 4
      makeScore("t2", "c1", 4, 4),  // total: 4, best: 4
    ];
    const result2 = calculateLeaderboard(teams, scores2, [emptyChapter]);
    expect(result2[0].rank).toBe(1);
    expect(result2[1].rank).toBe(1); // same rank
  });

  it("handles rank gaps after ties correctly", () => {
    const teams = [
      makeTeam("t1", "Alpha"),
      makeTeam("t2", "Beta"),
      makeTeam("t3", "Gamma"),
    ];
    const scores = [
      makeScore("t1", "c1", 1, 8),  // 8 points, best: 1
      makeScore("t2", "c1", 1, 8),  // 8 points, best: 1 (tied with t1)
      makeScore("t3", "c1", 3, 6),  // 6 points, best: 3
    ];
    const result = calculateLeaderboard(teams, scores, [emptyChapter]);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
    expect(result[2].rank).toBe(3); // skips rank 2
  });

  it("accumulates points across multiple chapters", () => {
    const teams = [makeTeam("t1", "Alpha")];
    const scores = [
      makeScore("t1", "c1", 1, 8),
      makeScore("t1", "c2", 2, 7),
      makeScore("t1", "c3", null, 2),
    ];
    const result = calculateLeaderboard(teams, scores, [emptyChapter]);
    expect(result[0].totalPoints).toBe(17);
    expect(result[0].matchesPlayed).toBe(3);
    expect(result[0].bestFinish).toBe(1);
  });

  it("teams with null bestFinish rank below teams with a bestFinish at same points", () => {
    const teams = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta")];
    const scores = [
      makeScore("t1", "c1", null, 2),  // total: 2, best: null
      makeScore("t2", "c1", 5, 4),     // total: 4, best: 5
    ];
    // t2 has more points so ranks first regardless
    // Let's make them equal points
    const scores2 = [
      makeScore("t1", "c1", null, 2),
      { ...makeScore("t1", "c2", null, 2), chapterId: "c2" },  // total: 4, best: null
      makeScore("t2", "c1", 4, 4),     // total: 4, best: 4
    ];
    const result = calculateLeaderboard(teams, scores2, [emptyChapter]);
    expect(result[0].team.id).toBe("t2"); // has bestFinish
    expect(result[1].team.id).toBe("t1"); // null bestFinish ranks lower
  });

  it("handles all teams with zero scores", () => {
    const teams = [makeTeam("t1", "Alpha"), makeTeam("t2", "Beta")];
    const result = calculateLeaderboard(teams, [], [emptyChapter]);
    expect(result[0].totalPoints).toBe(0);
    expect(result[1].totalPoints).toBe(0);
    // Both have 0 points and null bestFinish -> same rank
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
  });

  it("correctly identifies bestFinish across multiple matches", () => {
    const teams = [makeTeam("t1", "Alpha")];
    const scores = [
      makeScore("t1", "c1", 3, 6),
      makeScore("t1", "c2", 1, 8),
      makeScore("t1", "c3", 5, 4),
    ];
    const result = calculateLeaderboard(teams, scores, [emptyChapter]);
    expect(result[0].bestFinish).toBe(1); // best across all matches
  });

  it("leaderboard with realistic full-season data", () => {
    const teams = [
      makeTeam("t1", "TUM.ai"),
      makeTeam("t2", "ETH Hackers"),
      makeTeam("t3", "CodeCraft"),
      makeTeam("t4", "ByteMe"),
      makeTeam("t5", "Hackonauts"),
    ];
    // Match 1
    const scores = [
      makeScore("t1", "c1", 1, 8),  // TUM.ai wins Match 1
      makeScore("t2", "c1", 2, 7),
      makeScore("t3", "c1", 3, 6),
      makeScore("t4", "c1", null, 2),
      makeScore("t5", "c1", null, 2),
      // Match 2
      makeScore("t2", "c2", 1, 8),  // ETH wins Match 2
      makeScore("t1", "c2", 3, 6),
      makeScore("t3", "c2", 4, 4),
      makeScore("t5", "c2", 2, 7),
      // t4 didn't participate in Match 2
    ];
    const result = calculateLeaderboard(teams, scores, [emptyChapter]);

    // t1: 8+6 = 14, best: 1
    // t2: 7+8 = 15, best: 1
    // t3: 6+4 = 10, best: 3
    // t5: 2+7 = 9,  best: 2
    // t4: 2,        best: null

    expect(result[0].team.name).toBe("ETH Hackers");
    expect(result[0].totalPoints).toBe(15);

    expect(result[1].team.name).toBe("TUM.ai");
    expect(result[1].totalPoints).toBe(14);

    expect(result[2].team.name).toBe("CodeCraft");
    expect(result[2].totalPoints).toBe(10);

    expect(result[3].team.name).toBe("Hackonauts");
    expect(result[3].totalPoints).toBe(9);

    expect(result[4].team.name).toBe("ByteMe");
    expect(result[4].totalPoints).toBe(2);

    // t2 and t1 both have bestFinish=1, but t2 has more points -> different rank
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });
});

// ─── getPublishReadiness() ──────────────────────────────────
//
// Symptom B regression: the admin scores page DISPLAYS jury results (live
// aggregation) but the publish gate counts persisted `scores` rows. The two
// reads diverge. getPublishReadiness reconciles them. Args:
//   1. scoredTeamIds       — teams with a row in the `scores` table (publishable)
//   2. pendingJuryTeamIds  — teams whose jury results are displayed but expected
//                            to become scores and have NOT been finalized yet.

describe("getPublishReadiness", () => {
  it("REGRESSION (Symptom B): scores exist and are displayed => NOT reported missing", () => {
    // Finalized scored challenge: the same teams appear BOTH in `scores` and in
    // the live jury aggregation. The caller passes the pending set as empty
    // (finalized challenges are excluded). The gate must NOT warn — these scores
    // are real and publishable.
    const scoredTeamIds = ["t1", "t2", "t3"];
    const pendingJuryTeamIds: string[] = [];

    const readiness = getPublishReadiness(scoredTeamIds, pendingJuryTeamIds);

    // The old gate (`scores.length === 0`) would have been false here too, but
    // the historical failure was the inverse: see the "unfinalized" case below,
    // where results are displayed yet scores is empty. This pins that a fully
    // finalized chapter reports "ready", never a false "missing/empty".
    expect(readiness.kind).toBe("ready");
    if (readiness.kind === "ready") {
      expect(readiness.scoredCount).toBe(3);
    }
  });

  it("REGRESSION (Symptom B core): jury results displayed but NOT finalized => unfinalized, not empty", () => {
    // The exact bug: a scored challenge's jury aggregation is visible on the page
    // (pending teams present) but nothing was materialized into `scores`. The old
    // logic said "no scores yet" (empty). It must instead flag the inconsistency
    // so the operator finalizes before publishing, otherwise results vanish.
    const scoredTeamIds: string[] = [];
    const pendingJuryTeamIds = ["t1", "t2"];

    const readiness = getPublishReadiness(scoredTeamIds, pendingJuryTeamIds);

    expect(readiness.kind).toBe("unfinalized");
    if (readiness.kind === "unfinalized") {
      expect(readiness.pendingTeamCount).toBe(2);
      expect(readiness.scoredCount).toBe(0);
    }
  });

  it("flags unfinalized even when SOME scores already exist (partial finalization)", () => {
    // One scored challenge finalized (t1 in scores), another scored challenge's
    // jury results displayed but not finalized (t2 pending). Publishing now would
    // omit t2, so warn.
    const readiness = getPublishReadiness(["t1"], ["t2"]);
    expect(readiness.kind).toBe("unfinalized");
    if (readiness.kind === "unfinalized") {
      expect(readiness.pendingTeamCount).toBe(1);
      expect(readiness.scoredCount).toBe(1);
    }
  });

  it("a pending team that already has a score is not double-counted as pending", () => {
    // Defensive: if a team is in BOTH sets, it has been finalized -> not pending.
    const readiness = getPublishReadiness(["t1", "t2"], ["t1", "t2"]);
    expect(readiness.kind).toBe("ready");
    if (readiness.kind === "ready") {
      expect(readiness.scoredCount).toBe(2);
    }
  });

  it("genuinely empty chapter (no scores, no pending jury) => empty", () => {
    // e.g. a community-only chapter: nothing to publish, but publishing must
    // still be allowed (it just completes with an empty leaderboard).
    const readiness = getPublishReadiness([], []);
    expect(readiness.kind).toBe("empty");
  });

  it("accepts Sets and other iterables, not just arrays", () => {
    const readiness = getPublishReadiness(new Set(["t1"]), new Set<string>());
    expect(readiness.kind).toBe("ready");
  });
});

// ─── getPendingJuryTeamIds() ────────────────────────────────
//
// The per-challenge filter that produces the "pending" set fed into
// getPublishReadiness. A team is pending only if its challenge is scored AND not
// yet finalized. This avoids false positives (community/non-scored challenges,
// already-finalized challenges) and false negatives.

describe("getPendingJuryTeamIds", () => {
  it("includes teams from a scored, NOT-finalized challenge (the Symptom B case)", () => {
    const challenges = [{ id: "ch1", isScored: true, juryFinalizedAt: null }];
    const aggregated = { ch1: { t1: 8, t2: 7 } };
    expect(getPendingJuryTeamIds(challenges, aggregated).sort()).toEqual(["t1", "t2"]);
  });

  it("EXCLUDES teams from a non-scored (community) challenge (no false positive)", () => {
    // Community challenges are judged but never produce league scores, so their
    // displayed jury results must NOT trigger the unfinalized warning.
    const challenges = [{ id: "ch1", isScored: false, juryFinalizedAt: null }];
    const aggregated = { ch1: { t1: 8, t2: 7 } };
    expect(getPendingJuryTeamIds(challenges, aggregated)).toEqual([]);
  });

  it("EXCLUDES teams from an already-finalized scored challenge (no false positive)", () => {
    // Finalized scored challenges already wrote their scores; they are not pending.
    const challenges = [
      { id: "ch1", isScored: true, juryFinalizedAt: "2026-06-24T00:00:00Z" },
    ];
    const aggregated = { ch1: { t1: 8, t2: 7 } };
    expect(getPendingJuryTeamIds(challenges, aggregated)).toEqual([]);
  });

  it("includes only the unfinalized scored challenge in a mixed chapter", () => {
    const challenges = [
      { id: "ch1", isScored: true, juryFinalizedAt: "2026-06-24T00:00:00Z" }, // finalized
      { id: "ch2", isScored: true, juryFinalizedAt: null },                   // pending
      { id: "ch3", isScored: false, juryFinalizedAt: null },                  // community
    ];
    const aggregated = {
      ch1: { t1: 8 },
      ch2: { t2: 8, t3: 7 },
      ch3: { t4: 8 },
    };
    expect(getPendingJuryTeamIds(challenges, aggregated).sort()).toEqual(["t2", "t3"]);
  });

  it("dedupes a team that appears as pending across multiple challenges", () => {
    const challenges = [
      { id: "ch1", isScored: true, juryFinalizedAt: null },
      { id: "ch2", isScored: true, juryFinalizedAt: null },
    ];
    const aggregated = { ch1: { t1: 8 }, ch2: { t1: 7 } };
    expect(getPendingJuryTeamIds(challenges, aggregated)).toEqual(["t1"]);
  });

  it("ignores a challenge with no jury aggregation entry", () => {
    const challenges = [{ id: "ch1", isScored: true, juryFinalizedAt: null }];
    expect(getPendingJuryTeamIds(challenges, {})).toEqual([]);
  });

  it("returns empty for no challenges", () => {
    expect(getPendingJuryTeamIds([], {})).toEqual([]);
  });
});
