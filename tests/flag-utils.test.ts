import { describe, it, expect } from "vitest";
import {
  extractLinkedInUsername,
  extractGitHubUsername,
  normalizeName,
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
