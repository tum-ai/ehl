import { describe, it, expect } from "vitest";
import {
  cn,
  formatDate,
  formatDateRange,
  formatDateFull,
  getPlacementLabel,
  getPlacementColor,
  slugify,
  getSafeRedirect,
  redactSecretTokens,
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

  it("names both months for a cross-month range", () => {
    expect(formatDateRange("2026-05-30", "2026-06-01")).toBe(
      "30 May - 1 June 2026"
    );
  });

  it("names both years for a cross-year range", () => {
    expect(formatDateRange("2026-12-31", "2027-01-02")).toBe(
      "31 December 2026 - 2 January 2027"
    );
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

// ─── slugify() ─────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Team Alpha")).toBe("team-alpha");
  });

  it("collapses non-alphanumeric runs and trims separators", () => {
    expect(slugify("  Hello,  World!! ")).toBe("hello-world");
    expect(slugify("a---b")).toBe("a-b");
  });

  it("strips diacritics-adjacent characters (non-latin removed)", () => {
    // Non [a-z0-9] characters are dropped; "Über" -> "ber"
    expect(slugify("Über Team")).toBe("ber-team");
  });

  it("returns empty string when the name has no alphanumerics", () => {
    // Documents the empty-slug case that team creation must reject before
    // inserting (an empty slug produces an unreachable /team/ URL).
    expect(slugify("!!!")).toBe("");
    expect(slugify("🔥🔥")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("keeps numbers", () => {
    expect(slugify("Team 42")).toBe("team-42");
  });
});

// ─── getSafeRedirect() (open-redirect guard) ───────────────

describe("getSafeRedirect", () => {
  it("allows a plain internal path", () => {
    expect(getSafeRedirect("/dashboard")).toBe("/dashboard");
    expect(getSafeRedirect("/admin/chapters")).toBe("/admin/chapters");
  });

  it("returns null for null/undefined/empty", () => {
    expect(getSafeRedirect(null)).toBeNull();
    expect(getSafeRedirect(undefined)).toBeNull();
    expect(getSafeRedirect("")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    expect(getSafeRedirect("//evil.com")).toBeNull();
    expect(getSafeRedirect("//evil.com/path")).toBeNull();
  });

  it("rejects backslash tricks", () => {
    expect(getSafeRedirect("/\\evil.com")).toBeNull();
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(getSafeRedirect("https://evil.com")).toBeNull();
    expect(getSafeRedirect("http://evil.com")).toBeNull();
  });

  it("rejects a path that does not start with /", () => {
    expect(getSafeRedirect("dashboard")).toBeNull();
    expect(getSafeRedirect("evil.com")).toBeNull();
  });

  it("rejects URL-encoded protocol-relative bypass", () => {
    // decodeURIComponent turns %2F%2F into //, which must still be blocked
    expect(getSafeRedirect("%2F%2Fevil.com")).toBeNull();
  });

  it("rejects an embedded scheme like /javascript:", () => {
    expect(getSafeRedirect("/javascript:alert(1)")).toBeNull();
  });
});

// ─── redactSecretTokens() ───────────────────────────────────

describe("redactSecretTokens", () => {
  it("redacts a /showcase/<token> path so the bearer token is not logged", () => {
    expect(
      redactSecretTokens("https://ehl.gg/showcase/11111111-2222-3333-4444-555555555555")
    ).toBe("https://ehl.gg/showcase/<redacted>");
  });

  it("redacts a /walk-in/<token> path", () => {
    expect(redactSecretTokens("/walk-in/abc-secret-token")).toBe("/walk-in/<redacted>");
  });

  it("redacts the token in an /api/showcase/<token>/cv/<id> path but keeps the rest", () => {
    expect(
      redactSecretTokens("/api/showcase/secret-token/cv/app-123")
    ).toBe("/api/showcase/<redacted>/cv/app-123");
  });

  it("redacts a token embedded inside a longer string (e.g. a stack trace)", () => {
    const stack = "Error at /showcase/deadbeef-token\n  at renderPage (/showcase/deadbeef-token:1:1)";
    const out = redactSecretTokens(stack);
    expect(out).not.toContain("deadbeef-token");
    expect(out).toContain("/showcase/<redacted>");
  });

  it("redacts an /invite/<token> path (team-join bearer link)", () => {
    expect(redactSecretTokens("https://ehl.gg/invite/3f9a-team-invite")).toBe(
      "https://ehl.gg/invite/<redacted>"
    );
  });

  it("redacts secret query params (token, token_hash, code, invite)", () => {
    expect(redactSecretTokens("/register?invite=abc123")).toBe("/register?invite=<redacted>");
    expect(
      redactSecretTokens("/auth/callback?token_hash=xyz&type=magiclink&next=/dashboard")
    ).toBe("/auth/callback?token_hash=<redacted>&type=magiclink&next=/dashboard");
    expect(redactSecretTokens("/auth/callback?code=pkce-code-value")).toBe(
      "/auth/callback?code=<redacted>"
    );
  });

  it("leaves URLs without a secret token untouched", () => {
    expect(redactSecretTokens("https://ehl.gg/leaderboard")).toBe("https://ehl.gg/leaderboard");
    expect(redactSecretTokens("/matches/munich-1")).toBe("/matches/munich-1");
    expect(redactSecretTokens("/matches/munich-1?tab=results")).toBe("/matches/munich-1?tab=results");
  });
});
