import { describe, it, expect } from "vitest";
import {
  isBackwardTransition,
  getTargetIndex,
  getNextStatus,
  isDateExact,
  validateAnnouncedReady,
  validateApplicationsOpenReady,
  validateRegistrationOpenReady,
  validateHackingReady,
  validatePitchingReady,
  validateCompletedReady,
  getStatusChecksForTarget,
} from "@/lib/chapter-validation";
import type { ChapterStatus } from "@/lib/types";

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
});

// ─── getTargetIndex ─────────────────────────────────────────

describe("getTargetIndex", () => {
  it("returns 0 for draft", () => {
    expect(getTargetIndex("draft")).toBe(0);
  });

  it("returns 7 for completed", () => {
    expect(getTargetIndex("completed")).toBe(7);
  });

  it("returns correct indices for all statuses", () => {
    const statuses: ChapterStatus[] = [
      "draft", "announced", "applications_open", "screening",
      "registration_open", "submissions_open", "pitching", "completed",
    ];
    statuses.forEach((s, i) => {
      expect(getTargetIndex(s)).toBe(i);
    });
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

  it("returns pitching for submissions_open", () => {
    expect(getNextStatus("submissions_open")).toBe("pitching");
  });
});

// ─── isDateExact ────────────────────────────────────────────

describe("isDateExact", () => {
  it("returns false for null", () => {
    expect(isDateExact(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDateExact(undefined)).toBe(false);
  });

  it("returns false for day=1 (approximate date)", () => {
    expect(isDateExact("2026-05-01")).toBe(false);
    expect(isDateExact("2026-01-01")).toBe(false);
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

  it("fails for missing name", () => {
    const checks = validateAnnouncedReady({
      name: null,
      city: "Munich",
      country: "Germany",
      description: "Test",
    });
    expect(checks.find((c) => c.label === "Name is set")?.passed).toBe(false);
  });

  it("fails for empty string name", () => {
    const checks = validateAnnouncedReady({
      name: "",
      city: "Munich",
      country: "Germany",
      description: "Test",
    });
    expect(checks.find((c) => c.label === "Name is set")?.passed).toBe(false);
  });

  it("fails for whitespace-only name", () => {
    const checks = validateAnnouncedReady({
      name: "   ",
      city: "Munich",
      country: "Germany",
      description: "Test",
    });
    expect(checks.find((c) => c.label === "Name is set")?.passed).toBe(false);
  });

  it("fails for missing city", () => {
    const checks = validateAnnouncedReady({
      name: "Match 1",
      city: null,
      country: "Germany",
      description: "Test",
    });
    expect(checks.find((c) => c.label === "City is set")?.passed).toBe(false);
  });

  it("fails for missing country", () => {
    const checks = validateAnnouncedReady({
      name: "Match 1",
      city: "Munich",
      country: null,
      description: "Test",
    });
    expect(checks.find((c) => c.label === "Country is set")?.passed).toBe(false);
  });

  it("fails for missing description", () => {
    const checks = validateAnnouncedReady({
      name: "Match 1",
      city: "Munich",
      country: "Germany",
      description: null,
    });
    expect(checks.find((c) => c.label === "Description is set")?.passed).toBe(false);
  });

  it("fails for all fields missing", () => {
    const checks = validateAnnouncedReady({});
    expect(checks.filter((c) => !c.passed)).toHaveLength(4);
  });
});

// ─── validateApplicationsOpenReady ──────────────────────────

describe("validateApplicationsOpenReady", () => {
  it("passes with exact date", () => {
    const checks = validateApplicationsOpenReady({ date: "2026-05-15" });
    expect(checks[0].passed).toBe(true);
  });

  it("fails with approximate date (day=1)", () => {
    const checks = validateApplicationsOpenReady({ date: "2026-05-01" });
    expect(checks[0].passed).toBe(false);
  });

  it("fails with null date", () => {
    const checks = validateApplicationsOpenReady({ date: null });
    expect(checks[0].passed).toBe(false);
  });
});

// ─── validateRegistrationOpenReady ──────────────────────────

describe("validateRegistrationOpenReady", () => {
  it("all pass with exact date, end date, and challenges", () => {
    const checks = validateRegistrationOpenReady(
      { date: "2026-05-15", date_end: "2026-05-16" },
      2
    );
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("fails without end date", () => {
    const checks = validateRegistrationOpenReady(
      { date: "2026-05-15", date_end: null },
      2
    );
    expect(checks.find((c) => c.label === "End date is set")?.passed).toBe(false);
  });

  it("fails with 0 challenges", () => {
    const checks = validateRegistrationOpenReady(
      { date: "2026-05-15", date_end: "2026-05-16" },
      0
    );
    expect(
      checks.find((c) => c.label === "At least one challenge exists")?.passed
    ).toBe(false);
  });

  it("fails with approximate date", () => {
    const checks = validateRegistrationOpenReady(
      { date: "2026-05-01", date_end: "2026-05-16" },
      1
    );
    expect(
      checks.find((c) => c.label === "Exact start date is set")?.passed
    ).toBe(false);
  });
});

// ─── validateHackingReady ───────────────────────────────────

describe("validateHackingReady", () => {
  it("passes with registrations", () => {
    expect(validateHackingReady(1)[0].passed).toBe(true);
    expect(validateHackingReady(10)[0].passed).toBe(true);
  });

  it("fails with 0 registrations", () => {
    expect(validateHackingReady(0)[0].passed).toBe(false);
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
      checks.find(
        (c) => c.label === "Jury is assigned to at least one challenge"
      )?.passed
    ).toBe(false);
  });

  it("fails with both 0", () => {
    const checks = validatePitchingReady(0, 0);
    expect(checks.filter((c) => !c.passed)).toHaveLength(2);
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

// ─── getStatusChecksForTarget (integration of all checks) ──

describe("getStatusChecksForTarget", () => {
  const fullChapter = {
    name: "Match 1",
    city: "Munich",
    country: "Germany",
    description: "Test event",
    date: "2026-05-15",
    date_end: "2026-05-16",
  };

  const fullCounts = {
    challengeCount: 2,
    registrationCount: 5,
    submissionCount: 3,
    juryCount: 2,
    publishedScoreCount: 5,
  };

  it("returns empty array for backward transition", () => {
    const checks = getStatusChecksForTarget(
      "announced",
      "draft",
      fullChapter,
      fullCounts
    );
    expect(checks).toEqual([]);
  });

  it("returns empty array for same status", () => {
    const checks = getStatusChecksForTarget(
      "hacking",
      "hacking",
      fullChapter,
      fullCounts
    );
    expect(checks).toEqual([]);
  });

  it("returns only announced checks for draft -> announced", () => {
    const checks = getStatusChecksForTarget(
      "draft",
      "announced",
      fullChapter,
      fullCounts
    );
    expect(checks).toHaveLength(4); // name, city, country, description
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("returns announced + applications_open checks for draft -> applications_open", () => {
    const checks = getStatusChecksForTarget(
      "draft",
      "applications_open",
      fullChapter,
      fullCounts
    );
    expect(checks).toHaveLength(5); // 4 announced + 1 exact date
  });

  it("accumulates all checks for draft -> completed", () => {
    const checks = getStatusChecksForTarget(
      "draft",
      "completed",
      fullChapter,
      fullCounts
    );
    // announced(4) + applications_open(1) + registration_open(3) + hacking(1) + pitching(2) + completed(1) = 12
    expect(checks).toHaveLength(12);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it("shows failures when chapter data is incomplete", () => {
    const incompleteChapter = { name: "Test" };
    const checks = getStatusChecksForTarget(
      "draft",
      "announced",
      incompleteChapter,
      {}
    );
    const failures = checks.filter((c) => !c.passed);
    expect(failures.length).toBe(3); // city, country, description missing
  });

  it("skips submissions_open checks (none exist)", () => {
    // Going from hacking to submissions_open should only add up to hacking checks
    const checks = getStatusChecksForTarget(
      "draft",
      "submissions_open",
      fullChapter,
      fullCounts
    );
    // announced(4) + applications_open(1) + registration_open(3) + hacking(1) = 9
    // submissions_open adds no new checks
    expect(checks).toHaveLength(9);
  });
});
