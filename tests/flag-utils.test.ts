import { describe, it, expect } from "vitest";
import {
  extractLinkedInUsername,
  extractGitHubUsername,
  normalizeName,
  nameSimilarity,
  findBestNameMatch,
} from "@/lib/flag-utils";

// ─── extractLinkedInUsername ────────────────────────────────

describe("extractLinkedInUsername", () => {
  it("extracts username from standard URL", () => {
    expect(extractLinkedInUsername("https://www.linkedin.com/in/johndoe")).toBe(
      "johndoe"
    );
  });

  it("extracts username from URL with trailing slash", () => {
    expect(
      extractLinkedInUsername("https://linkedin.com/in/johndoe/")
    ).toBe("johndoe");
  });

  it("extracts username from URL with query params", () => {
    expect(
      extractLinkedInUsername(
        "https://www.linkedin.com/in/johndoe?trk=profile"
      )
    ).toBe("johndoe");
  });

  it("extracts username from URL without protocol", () => {
    expect(extractLinkedInUsername("linkedin.com/in/johndoe")).toBe("johndoe");
  });

  it("lowercases the username", () => {
    expect(
      extractLinkedInUsername("https://linkedin.com/in/JohnDoe")
    ).toBe("johndoe");
  });

  it("returns null for empty string", () => {
    expect(extractLinkedInUsername("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractLinkedInUsername(null)).toBeNull();
    expect(extractLinkedInUsername(undefined)).toBeNull();
  });

  it("returns null for non-LinkedIn URL", () => {
    expect(extractLinkedInUsername("https://github.com/johndoe")).toBeNull();
  });

  it("returns null for LinkedIn URL without /in/ path", () => {
    expect(
      extractLinkedInUsername("https://linkedin.com/company/acme")
    ).toBeNull();
  });
});

// ─── extractGitHubUsername ──────────────────────────────────

describe("extractGitHubUsername", () => {
  it("extracts username from standard URL", () => {
    expect(extractGitHubUsername("https://github.com/johndoe")).toBe(
      "johndoe"
    );
  });

  it("extracts username from URL with repo path", () => {
    expect(
      extractGitHubUsername("https://github.com/johndoe/my-repo")
    ).toBe("johndoe");
  });

  it("extracts username from URL with trailing slash", () => {
    expect(extractGitHubUsername("github.com/johndoe/")).toBe("johndoe");
  });

  it("lowercases the username", () => {
    expect(extractGitHubUsername("https://github.com/JohnDoe")).toBe(
      "johndoe"
    );
  });

  it("returns null for empty string", () => {
    expect(extractGitHubUsername("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractGitHubUsername(null)).toBeNull();
    expect(extractGitHubUsername(undefined)).toBeNull();
  });

  it("returns null for non-GitHub URL", () => {
    expect(
      extractGitHubUsername("https://linkedin.com/in/johndoe")
    ).toBeNull();
  });

  it("filters out GitHub reserved paths", () => {
    expect(extractGitHubUsername("https://github.com/orgs")).toBeNull();
    expect(extractGitHubUsername("https://github.com/settings")).toBeNull();
    expect(extractGitHubUsername("https://github.com/explore")).toBeNull();
  });
});

// ─── normalizeName ─────────────────────────────────────────

describe("normalizeName", () => {
  it("normalizes first and last name", () => {
    expect(normalizeName("John", "Doe")).toBe("john doe");
  });

  it("collapses extra whitespace", () => {
    expect(normalizeName("  John  ", "  Doe  ")).toBe("john doe");
  });

  it("lowercases", () => {
    expect(normalizeName("JOHN", "DOE")).toBe("john doe");
  });

  it("handles first name only", () => {
    expect(normalizeName("John", null)).toBe("john");
  });

  it("handles last name only", () => {
    expect(normalizeName(null, "Doe")).toBe("doe");
  });

  it("returns null for both empty", () => {
    expect(normalizeName(null, null)).toBeNull();
    expect(normalizeName("", "")).toBeNull();
    expect(normalizeName(undefined, undefined)).toBeNull();
  });
});

// ─── nameSimilarity ───────────────────────────────────────

describe("nameSimilarity", () => {
  it("returns 1 for identical names", () => {
    expect(nameSimilarity("Julian Sikora", "Julian Sikora")).toBe(1);
  });

  it("returns 1 for same name different case", () => {
    expect(nameSimilarity("julian sikora", "Julian Sikora")).toBe(1);
  });

  it("returns 1 for same name different order", () => {
    expect(nameSimilarity("Sikora Julian", "Julian Sikora")).toBe(1);
  });

  it("handles middle names (subset match)", () => {
    const score = nameSimilarity("Julian Phillip Sikora", "Julian Sikora");
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });

  it("handles diacritics", () => {
    expect(nameSimilarity("Emre Pektas", "Emre Pektaş")).toBe(1);
  });

  it("handles slight misspelling", () => {
    const score = nameSimilarity("Stanislaw Gapczynski", "Stanisław Gapczyński");
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns low score for completely different names", () => {
    expect(nameSimilarity("Julian Sikora", "Max Mustermann")).toBeLessThan(0.3);
  });

  it("returns 0 for empty input", () => {
    expect(nameSimilarity("", "Julian Sikora")).toBe(0);
    expect(nameSimilarity("Julian Sikora", "")).toBe(0);
  });
});

// ─── findBestNameMatch ────────────────────────────────────

describe("findBestNameMatch", () => {
  const memberList = [
    "Julian Sikora",
    "Emre Pektaş",
    "Stanisław Gapczyński",
    "Fabian Hildesheim",
    "Anna Ketteler",
  ];

  it("finds exact match", () => {
    const result = findBestNameMatch("Julian Sikora", memberList);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Julian Sikora");
    expect(result!.score).toBe(1);
  });

  it("finds fuzzy match with diacritics stripped", () => {
    const result = findBestNameMatch("Emre Pektas", memberList);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Emre Pektaş");
    expect(result!.score).toBe(1);
  });

  it("finds fuzzy match with slight variation", () => {
    const result = findBestNameMatch("Stanislaw Gapczynski", memberList);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Stanisław Gapczyński");
    expect(result!.score).toBeGreaterThan(0.7);
  });

  it("returns null for no match", () => {
    const result = findBestNameMatch("Completely Unknown Person", memberList);
    expect(result).toBeNull();
  });

  it("returns null for empty name", () => {
    const result = findBestNameMatch("", memberList);
    expect(result).toBeNull();
  });

  it("respects threshold parameter", () => {
    // With a very high threshold, a fuzzy match might not qualify
    const result = findBestNameMatch("Stanislaw Gapczynski", memberList, 0.99);
    expect(result).toBeNull();
  });
});
