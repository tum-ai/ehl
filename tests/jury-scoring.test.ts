import { describe, it, expect } from "vitest";
import { validateJuryRanking } from "@/lib/jury-validation";

/**
 * Tests the REAL jury-ranking validation used by submitJuryRanking()
 * (lib/actions/jury.ts delegates to validateJuryRanking). Placement→points
 * and season aggregation are covered separately in scoring.test.ts.
 */

const teams = new Set(["team-a", "team-b", "team-c", "team-d", "team-e"]);

describe("validateJuryRanking", () => {
  it("accepts a valid consecutive top-3 ranking", () => {
    const ranking = { "1": "team-a", "2": "team-b", "3": "team-c" };
    expect(validateJuryRanking(ranking, teams)).toBeNull();
  });

  it("accepts a single-team ranking", () => {
    expect(validateJuryRanking({ "1": "team-a" }, teams)).toBeNull();
  });

  it("rejects an empty ranking", () => {
    expect(validateJuryRanking({}, teams)).toBe("Ranking cannot be empty.");
  });

  it("rejects placements that do not start at 1", () => {
    const ranking = { "2": "team-a", "3": "team-b" };
    expect(validateJuryRanking(ranking, teams)).toBe(
      "Invalid placement values. Must be consecutive starting at 1."
    );
  });

  it("rejects non-consecutive placements (gap)", () => {
    const ranking = { "1": "team-a", "3": "team-b" };
    expect(validateJuryRanking(ranking, teams)).toBe(
      "Invalid placement values. Must be consecutive starting at 1."
    );
  });

  it("rejects duplicate teams across placements", () => {
    const ranking = { "1": "team-a", "2": "team-a" };
    expect(validateJuryRanking(ranking, teams)).toBe("Duplicate teams in ranking.");
  });

  it("rejects a team that did not submit", () => {
    const ranking = { "1": "team-a", "2": "team-zzz" };
    expect(validateJuryRanking(ranking, teams)).toBe("Ranking contains invalid team.");
  });

  it("accepts a full 5-team ranking", () => {
    const ranking = {
      "1": "team-a",
      "2": "team-b",
      "3": "team-c",
      "4": "team-d",
      "5": "team-e",
    };
    expect(validateJuryRanking(ranking, teams)).toBeNull();
  });

  it("rejects when no teams submitted at all", () => {
    const ranking = { "1": "team-a" };
    expect(validateJuryRanking(ranking, new Set())).toBe(
      "Ranking contains invalid team."
    );
  });
});
