import { describe, it, expect } from "vitest";
import { deduplicatePartners } from "@/lib/queries";
import type { Partner } from "@/lib/types";

function makePartner(overrides: Partial<Partner> & { name: string }): Partner {
  return {
    id: crypto.randomUUID(),
    logoUrl: "https://example.com/logo.png",
    url: "https://example.com",
    tier: "tech_partner",
    description: null,
    displayOrder: 0,
    chapterId: null,
    ...overrides,
  };
}

describe("deduplicatePartners", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicatePartners([])).toEqual([]);
  });

  it("returns all partners when no duplicates", () => {
    const partners = [
      makePartner({ name: "Google", displayOrder: 0 }),
      makePartner({ name: "OpenAI", displayOrder: 1 }),
      makePartner({ name: "AMD", displayOrder: 2 }),
    ];
    expect(deduplicatePartners(partners)).toHaveLength(3);
  });

  it("removes duplicate by name, keeps first occurrence (lowest display_order)", () => {
    const first = makePartner({ name: "OpenAI", displayOrder: 0, chapterId: "ch-1" });
    const duplicate = makePartner({ name: "OpenAI", displayOrder: 1, chapterId: "ch-2" });
    const other = makePartner({ name: "Google", displayOrder: 2 });

    const result = deduplicatePartners([first, duplicate, other]);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(first.id);
    expect(result[1].id).toBe(other.id);
  });

  it("deduplicates case-insensitively", () => {
    const partners = [
      makePartner({ name: "openai", displayOrder: 0 }),
      makePartner({ name: "OpenAI", displayOrder: 1 }),
      makePartner({ name: "OPENAI", displayOrder: 2 }),
    ];
    expect(deduplicatePartners(partners)).toHaveLength(1);
    expect(deduplicatePartners(partners)[0].name).toBe("openai");
  });

  it("handles partner appearing in 3+ chapters", () => {
    const partners = [
      makePartner({ name: "AMD", displayOrder: 0, chapterId: "ch-1" }),
      makePartner({ name: "AMD", displayOrder: 1, chapterId: "ch-2" }),
      makePartner({ name: "AMD", displayOrder: 2, chapterId: "ch-3" }),
      makePartner({ name: "Google", displayOrder: 3, chapterId: null }),
    ];

    const result = deduplicatePartners(partners);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.name)).toEqual(["AMD", "Google"]);
  });

  it("preserves order of first occurrences", () => {
    const partners = [
      makePartner({ name: "Alpha", displayOrder: 0 }),
      makePartner({ name: "Beta", displayOrder: 1 }),
      makePartner({ name: "Alpha", displayOrder: 2, chapterId: "ch-1" }),
      makePartner({ name: "Gamma", displayOrder: 3 }),
      makePartner({ name: "Beta", displayOrder: 4, chapterId: "ch-2" }),
    ];

    const result = deduplicatePartners(partners);
    expect(result.map((p) => p.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});
