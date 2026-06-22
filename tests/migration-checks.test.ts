import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { resolve } from "path";
import { MIGRATION_CHECKS, findManifestProblems } from "../scripts/migration-checks";

/** Migration file prefixes actually present on disk. */
function migrationFilePrefixes(): string[] {
  const dir = resolve(__dirname, "../supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, 5))
    .sort();
}

describe("migration verification manifest", () => {
  it("has an entry for every migration file on disk (and vice versa)", () => {
    // This is the guard that matters: the rule is "every new migration must add
    // a check here". If someone adds 00048_*.sql without a manifest entry, this
    // fails loudly in CI rather than letting a prod migration go unverified.
    const problems = findManifestProblems(migrationFilePrefixes());
    expect(problems).toEqual([]);
  });

  it("uses unique, sorted prefixes", () => {
    const prefixes = MIGRATION_CHECKS.map((c) => c.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect([...prefixes].sort()).toEqual(prefixes);
  });

  it("every probed entry selects a `present` column", () => {
    for (const c of MIGRATION_CHECKS) {
      if (c.unverifiable) continue;
      expect(c.sql, `${c.prefix} ${c.label} has no sql`).toBeDefined();
      expect(c.sql!.toLowerCase(), `${c.prefix} ${c.label}`).toContain("as present");
    }
  });

  it("unverifiable entries have no sql, a reason, and any coveredBy is a later, real migration", () => {
    const prefixes = new Set(MIGRATION_CHECKS.map((c) => c.prefix));
    for (const c of MIGRATION_CHECKS) {
      if (!c.unverifiable) continue;
      expect(c.sql, `${c.prefix} is unverifiable but also has sql`).toBeUndefined();
      expect(c.unverifiable.reason, `${c.prefix} unverifiable without reason`).toBeTruthy();
      if (c.unverifiable.coveredBy) {
        expect(prefixes.has(c.unverifiable.coveredBy), `${c.prefix} -> ${c.unverifiable.coveredBy} missing`).toBe(true);
        expect(c.unverifiable.coveredBy > c.prefix, `${c.prefix} coveredBy earlier ${c.unverifiable.coveredBy}`).toBe(true);
      }
    }
  });

  describe("findManifestProblems", () => {
    it("flags a migration file with no manifest entry", () => {
      const problems = findManifestProblems([
        ...MIGRATION_CHECKS.map((c) => c.prefix),
        "99999",
      ]);
      expect(problems.some((p) => p.includes("99999") && p.includes("NO entry"))).toBe(true);
    });

    it("flags a manifest entry with no migration file", () => {
      // Drop one real prefix from the on-disk set -> that manifest entry is now orphaned.
      const without = MIGRATION_CHECKS.map((c) => c.prefix).filter((p) => p !== "00047");
      const problems = findManifestProblems(without);
      expect(problems.some((p) => p.includes("00047") && p.includes("no matching"))).toBe(true);
    });
  });
});
