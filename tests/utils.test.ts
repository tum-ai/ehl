import { describe, it, expect } from "vitest";
import {
  cn,
  formatDate,
  formatDateRange,
  formatDateFull,
  getPlacementLabel,
  getPlacementColor,
} from "@/lib/utils";

// ─── cn() ───────────────────────────────────────────────────

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes via clsx", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    const result = cn("px-4", "px-2");
    expect(result).toBe("px-2");
  });

  it("returns empty string for no args", () => {
    expect(cn()).toBe("");
  });
});

// ─── formatDate() ───────────────────────────────────────────

describe("formatDate", () => {
  it("returns TBA for null", () => {
    expect(formatDate(null)).toBe("TBA");
  });

  it("returns month + year for day=1 (approximate date)", () => {
    const result = formatDate("2026-05-01");
    expect(result).toContain("May");
    expect(result).toContain("2026");
    // Day 1 is treated as "approximate", so no day shown
    expect(result).not.toMatch(/\b1\b/);
  });

  it("returns day + month + year for exact dates", () => {
    const result = formatDate("2026-05-15");
    expect(result).toContain("May");
    expect(result).toContain("2026");
    expect(result).toContain("15");
  });
});

// ─── formatDateRange() ─────────────────────────────────────

describe("formatDateRange", () => {
  it("returns TBA for null start date", () => {
    expect(formatDateRange(null, null)).toBe("TBA");
    expect(formatDateRange(null, "2026-05-16")).toBe("TBA");
  });

  it("returns month + year for approximate date (day=1)", () => {
    const result = formatDateRange("2026-05-01", null);
    expect(result).toContain("May");
    expect(result).toContain("2026");
  });

  it("returns single date when no end date", () => {
    const result = formatDateRange("2026-05-15", null);
    expect(result).toContain("15");
    expect(result).toContain("May");
    expect(result).toContain("2026");
  });

  it("returns date range when both dates provided", () => {
    const result = formatDateRange("2026-05-15", "2026-05-16");
    expect(result).toBe("15-16 May 2026");
  });

  it("handles multi-day range", () => {
    const result = formatDateRange("2026-06-20", "2026-06-22");
    expect(result).toBe("20-22 June 2026");
  });
});

// ─── formatDateFull() ──────────────────────────────────────

describe("formatDateFull", () => {
  it("returns TBA for null", () => {
    expect(formatDateFull(null)).toBe("TBA");
  });

  it("returns month + year for approximate date (day=1)", () => {
    const result = formatDateFull("2026-07-01");
    expect(result).toContain("July");
    expect(result).toContain("2026");
  });

  it("returns full date without end date", () => {
    const result = formatDateFull("2026-07-15");
    expect(result).toContain("15");
    expect(result).toContain("July");
    expect(result).toContain("2026");
  });

  it("returns range with end date", () => {
    const result = formatDateFull("2026-07-15", "2026-07-17");
    expect(result).toBe("15-17 July 2026");
  });

  it("handles undefined end date same as null", () => {
    const withNull = formatDateFull("2026-07-15", null);
    const withUndefined = formatDateFull("2026-07-15", undefined);
    expect(withNull).toBe(withUndefined);
  });
});

// ─── getPlacementLabel() ────────────────────────────────────

describe("getPlacementLabel", () => {
  it("returns 1st for placement 1", () => {
    expect(getPlacementLabel(1)).toBe("1st");
  });

  it("returns 2nd for placement 2", () => {
    expect(getPlacementLabel(2)).toBe("2nd");
  });

  it("returns 3rd for placement 3", () => {
    expect(getPlacementLabel(3)).toBe("3rd");
  });

  it("returns 4th for placement 4", () => {
    expect(getPlacementLabel(4)).toBe("4th");
  });

  it("returns 5th for placement 5", () => {
    expect(getPlacementLabel(5)).toBe("5th");
  });

  it("returns nth for higher placements", () => {
    expect(getPlacementLabel(10)).toBe("10th");
    expect(getPlacementLabel(21)).toBe("21st");
    expect(getPlacementLabel(22)).toBe("22nd");
    expect(getPlacementLabel(23)).toBe("23rd");
    expect(getPlacementLabel(11)).toBe("11th");
    expect(getPlacementLabel(12)).toBe("12th");
    expect(getPlacementLabel(13)).toBe("13th");
    expect(getPlacementLabel(111)).toBe("111th");
    expect(getPlacementLabel(112)).toBe("112th");
  });
});

// ─── getPlacementColor() ───────────────────────────────────

describe("getPlacementColor", () => {
  it("returns text-gold for 1st place", () => {
    expect(getPlacementColor(1)).toBe("text-gold");
  });

  it("returns text-silver for 2nd place", () => {
    expect(getPlacementColor(2)).toBe("text-silver");
  });

  it("returns text-bronze for 3rd place", () => {
    expect(getPlacementColor(3)).toBe("text-bronze");
  });

  it("returns text-text-secondary for 4th and beyond", () => {
    expect(getPlacementColor(4)).toBe("text-text-secondary");
    expect(getPlacementColor(5)).toBe("text-text-secondary");
    expect(getPlacementColor(99)).toBe("text-text-secondary");
  });
});
