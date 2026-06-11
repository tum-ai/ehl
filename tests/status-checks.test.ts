import { describe, it, expect } from "vitest";
import {
  isBackwardTransition,
  getTargetIndex,
  getNextStatus,
  isDateExact,
  validateAnnouncedReady,
  validateApplicationsOpenReady,
  validateChallengeSelectionReady,
  validateSubmissionsOpenReady,
  validatePitchingReady,
  validateCompletedReady,
  getStatusChecksForTarget,
} from "@/lib/chapter-validation";
import type { ChapterStatus } from "@/lib/types";

// These functions are the LIVE status-readiness logic: lib/actions/admin.ts
// getStatusChecks gathers DB counts and delegates the flow/field decisions to
// getStatusChecksForTarget below. So this suite tests what production runs.

const FLOW: ChapterStatus[] = [
  "draft",
  "announced",
  "applications_open",
  "preparation",
  "challenge_selection",
  "hacking",
  "submissions_open",
  "pitching",
  "completed",
];

// ─── isBackwardTransition ───────────────────────────────────

describe("isBackwardTransition", () => {
  it("returns true when going from announced to draft", () => {
    expect(isBackwardTransition("announced", "draft")).toBe(true);
  });

  it("returns true when target equals current (same status)", () => {
    expect(isBackwardTransition("hacking", "hacking")).toBe(true);
  });

  it("returns false when going forward", () => {
    expect(isBackwardTransition("draft", "announced")).toBe(false);
  });

  it("returns true for completed to draft (full rollback)", () => {
    expect(isBackwardTransition("completed", "draft")).toBe(true);
  });

  it("returns false for draft to completed (full forward)", () => {
    expect(isBackwardTransition("draft", "completed")).toBe(false);
  });

  it("treats hacking -> submissions_open as forward (hacking is in the flow)", () => {
    expect(isBackwardTransition("hacking", "submissions_open")).toBe(false);
    expect(isBackwardTransition("submissions_open", "hacking")).toBe(true);
  });
});

// ─── getTargetIndex ─────────────────────────────────────────

describe("getTargetIndex", () => {
  it("returns 0 for draft", () => {
    expect(getTargetIndex("draft")).toBe(0);
  });

  it("returns the last index for completed", () => {
    expect(getTargetIndex("completed")).toBe(FLOW.length - 1);
  });

  it("returns correct indices for all statuses including hacking", () => {
    FLOW.forEach((s, i) => {
      expect(getTargetIndex(s)).toBe(i);
    });
  });

  it("places hacking between challenge_selection and submissions_open", () => {
    expect(getTargetIndex("hacking")).toBe(getTargetIndex("challenge_selection") + 1);
    expect(getTargetIndex("submissions_open")).toBe(getTargetIndex("hacking") + 1);
  });
});

// ─── getNextStatus ──────────────────────────────────────────

describe("getNextStatus", () => {
  it("returns announced for draft", () => {
    expect(getNextStatus("draft")).toBe("announced");
  });

  it("returns null for completed (no next)", () => {
    expect(getNextStatus("completed")).toBeNull();
  });

  it("returns hacking after challenge_selection", () => {
    expect(getNextStatus("challenge_selection")).toBe("hacking");
  });

  it("returns submissions_open after hacking", () => {
    expect(getNextStatus("hacking")).toBe("submissions_open");
  });
});

// ─── isDateExact ────────────────────────────────────────────

describe("isDateExact", () => {
  it("returns false for null/undefined", () => {
    expect(isDateExact(null)).toBe(false);
    expect(isDateExact(undefined)).toBe(false);
  });

  it("returns false for day=1 (approximate date)", () => {
    expect(isDateExact("2026-05-01")).toBe(false);
    expect(isDateExact("2026-12-01")).toBe(false);
  });

  it("returns true for exact dates (day != 1)", () => {
    expect(isDateExact("2026-05-15")).toBe(true);
    expect(isDateExact("2026-01-02")).toBe(true);
    expect(isDateExact("2026-12-31")).toBe(true);
  });
});

// ─── validateAnnouncedReady ─────────────────────────────────

describe("validateAnnouncedReady", () => {
  it("all pass with valid data", () => {
    const checks = validateAnnouncedReady({
      name: "Match 1",
      city: "Munich",
      country: "Germany",
      description: "A hackathon event",
    });
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails for missing/empty/whitespace name", () => {
    for (const name of [null, "", "   "]) {
      const checks = validateAnnouncedReady({
        name,
        city: "Munich",
        country: "Germany",
        description: "Test",
      });
      expect(checks.find((c) => c.label === "Name is set")?.passed).toBe(false);
    }
  });

  it("fails for each missing field", () => {
    const checks = validateAnnouncedReady({});
    expect(checks.filter((c) => !c.passed)).toHaveLength(4);
  });
});

// ─── validateApplicationsOpenReady ──────────────────────────

describe("validateApplicationsOpenReady", () => {
  it("passes with exact date and application deadline", () => {
    const checks = validateApplicationsOpenReady({
      date: "2026-05-15",
      application_deadline: "2026-05-01T00:00:00Z",
    });
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails with approximate date (day=1)", () => {
    const checks = validateApplicationsOpenReady({
      date: "2026-05-01",
      application_deadline: "2026-05-01T00:00:00Z",
    });
    expect(
      checks.find((c) => c.label.startsWith("Exact start date"))?.passed
    ).toBe(false);
  });

  it("fails when application deadline is missing", () => {
    const checks = validateApplicationsOpenReady({
      date: "2026-05-15",
      application_deadline: null,
    });
    expect(
      checks.find((c) => c.label === "Application deadline is set")?.passed
    ).toBe(false);
  });
});

// ─── validateChallengeSelectionReady ────────────────────────

describe("validateChallengeSelectionReady", () => {
  const ready = {
    date: "2026-05-15",
    date_end: "2026-05-16",
    challenge_selection_deadline: "2026-05-14T00:00:00Z",
  };

  it("all pass with dates, challenges, and deadline", () => {
    const checks = validateChallengeSelectionReady(ready, 2);
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails without end date", () => {
    const checks = validateChallengeSelectionReady({ ...ready, date_end: null }, 2);
    expect(checks.find((c) => c.label === "End date is set")?.passed).toBe(false);
  });

  it("fails with 0 challenges", () => {
    const checks = validateChallengeSelectionReady(ready, 0);
    expect(
      checks.find((c) => c.label === "At least one challenge exists")?.passed
    ).toBe(false);
  });

  it("fails without challenge selection deadline", () => {
    const checks = validateChallengeSelectionReady(
      { ...ready, challenge_selection_deadline: null },
      1
    );
    expect(
      checks.find((c) => c.label === "Challenge selection deadline is set")?.passed
    ).toBe(false);
  });
});

// ─── validateSubmissionsOpenReady ───────────────────────────

describe("validateSubmissionsOpenReady", () => {
  const ready = { submission_deadline: "2026-05-16T18:00:00Z" };

  it("passes with a registration and a submission deadline", () => {
    const checks = validateSubmissionsOpenReady(ready, 1);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails with 0 registrations", () => {
    const checks = validateSubmissionsOpenReady(ready, 0);
    expect(
      checks.find((c) => c.label === "At least one team is registered")?.passed
    ).toBe(false);
  });

  it("fails without a submission deadline", () => {
    const checks = validateSubmissionsOpenReady({ submission_deadline: null }, 1);
    expect(
      checks.find((c) => c.label === "Submission deadline is set")?.passed
    ).toBe(false);
  });

  it("adds a failing check listing challenges with unconfigured code review", () => {
    const checks = validateSubmissionsOpenReady(ready, 1, ["Challenge A", "Challenge B"]);
    const reviewCheck = checks.find((c) => c.label.startsWith("Code review not configured"));
    expect(reviewCheck).toBeDefined();
    expect(reviewCheck?.passed).toBe(false);
    expect(reviewCheck?.label).toContain("Challenge A");
    expect(reviewCheck?.label).toContain("Challenge B");
  });

  it("omits the code-review line when all review challenges are configured", () => {
    const checks = validateSubmissionsOpenReady(ready, 1, []);
    expect(checks.some((c) => c.label.includes("Code review"))).toBe(false);
  });
});

// ─── validatePitchingReady ──────────────────────────────────

describe("validatePitchingReady", () => {
  it("passes with submissions and jury", () => {
    const checks = validatePitchingReady(3, 2);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails with 0 submissions", () => {
    const checks = validatePitchingReady(0, 2);
    expect(
      checks.find((c) => c.label === "At least one submission exists")?.passed
    ).toBe(false);
  });

  it("fails with 0 jury", () => {
    const checks = validatePitchingReady(3, 0);
    expect(
      checks.find((c) => c.label === "Jury is assigned to at least one challenge")?.passed
    ).toBe(false);
  });

  it("fails both with both 0", () => {
    expect(validatePitchingReady(0, 0).filter((c) => !c.passed)).toHaveLength(2);
  });
});

// ─── validateCompletedReady ─────────────────────────────────

describe("validateCompletedReady", () => {
  it("passes with published scores", () => {
    expect(validateCompletedReady(1)[0].passed).toBe(true);
  });

  it("fails with 0 published scores", () => {
    expect(validateCompletedReady(0)[0].passed).toBe(false);
  });
});

// ─── getStatusChecksForTarget (the live aggregate) ──────────

describe("getStatusChecksForTarget", () => {
  const fullChapter = {
    name: "Match 1",
    city: "Munich",
    country: "Germany",
    description: "Test event",
    date: "2026-05-15",
    date_end: "2026-05-16",
    application_deadline: "2026-05-01T00:00:00Z",
    challenge_selection_deadline: "2026-05-14T00:00:00Z",
    submission_deadline: "2026-05-16T18:00:00Z",
  };

  const fullCounts = {
    challengeCount: 2,
    registrationCount: 5,
    submissionCount: 3,
    juryCount: 2,
    publishedScoreCount: 5,
    unconfiguredReviewChallenges: [],
  };

  it("returns empty array for a backward transition", () => {
    expect(
      getStatusChecksForTarget("announced", "draft", fullChapter, fullCounts)
    ).toEqual([]);
  });

  it("returns empty array for same status", () => {
    expect(
      getStatusChecksForTarget("hacking", "hacking", fullChapter, fullCounts)
    ).toEqual([]);
  });

  it("returns only the 4 announced checks for draft -> announced", () => {
    const checks = getStatusChecksForTarget("draft", "announced", fullChapter, fullCounts);
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("returns announced + applications_open (4 + 2) for draft -> applications_open", () => {
    const checks = getStatusChecksForTarget(
      "draft",
      "applications_open",
      fullChapter,
      fullCounts
    );
    expect(checks).toHaveLength(6);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("accumulates all checks for draft -> completed and all pass with full data", () => {
    const checks = getStatusChecksForTarget("draft", "completed", fullChapter, fullCounts);
    // announced(4) + applications_open(2) + challenge_selection(4)
    //   + hacking/submissions_open(2) + pitching(2) + completed(1) = 15
    expect(checks).toHaveLength(15);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("hacking and submissions_open accumulate the same checks (submissions_open adds none)", () => {
    const toHacking = getStatusChecksForTarget("draft", "hacking", fullChapter, fullCounts);
    const toSubmissions = getStatusChecksForTarget(
      "draft",
      "submissions_open",
      fullChapter,
      fullCounts
    );
    // announced(4) + applications_open(2) + challenge_selection(4) + hacking(2) = 12
    expect(toHacking).toHaveLength(12);
    expect(toSubmissions).toHaveLength(12);
  });

  it("surfaces failures when chapter data is incomplete", () => {
    const checks = getStatusChecksForTarget("draft", "announced", { name: "Test" }, {});
    expect(checks.filter((c) => !c.passed)).toHaveLength(3); // city, country, description
  });

  it("surfaces an unconfigured-code-review failure on the way to completed", () => {
    const checks = getStatusChecksForTarget("draft", "completed", fullChapter, {
      ...fullCounts,
      unconfiguredReviewChallenges: ["Sponsor Challenge"],
    });
    const reviewCheck = checks.find((c) => c.label.startsWith("Code review not configured"));
    expect(reviewCheck?.passed).toBe(false);
    expect(reviewCheck?.label).toContain("Sponsor Challenge");
  });
});
