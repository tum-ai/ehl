import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The local (chapter) admin feature was removed (migration 00074 dropped
// chapter_admins). Its 'chapter_admin' value is still in the user_role enum, so
// nothing stops new code from quietly reaching for the role or the table again.
// This test fails the build if any source file mentions them, except the few
// places that must keep doing so on purpose.

const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "components", "scripts", "tests", "e2e", "supabase"];
const SOURCE_FILE = /\.(ts|tsx|js|mjs|sql)$/;
// Identifiers, plus prose ("chapter admin", "chapter-admin", "local (chapter)
// admin") so a stale comment or UI string is caught too.
const LEFTOVER =
  /\bchapter_admins?\b|requireChapterAdmin(Page|Action|Api)|requireGlobalAdminPage|getAdminChapterId|inviteChapterAdmin|\bchapter[ -]admins?\b|local \(chapter\) admin/i;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (SOURCE_FILE.test(name)) out.push(full);
  }
  return out;
}

/**
 * Whether `path` (repo-relative, forward slashes) may still mention the removed
 * feature. Everything else must not.
 */
function isAllowedToMention(path: string): boolean {
  // Migrations are append-only history: up to and including 00074 (which
  // removes the feature) they must keep their references. A LATER migration
  // mentioning the table would be reintroducing it, so it is not exempt.
  const migration = /^supabase\/migrations\/(\d{5})_/.exec(path);
  if (migration) return Number(migration[1]) <= 74;
  return ALLOWED_FILES.has(path);
}

const ALLOWED_FILES = new Set([
  "scripts/migration-checks.ts", // probes that 00074 removed the table
  "tests/admin-middleware.test.ts", // asserts a leftover role is refused
  "tests/no-chapter-admin-leftovers.test.ts", // this file
]);

describe("local admin feature stays removed", () => {
  it("no source file outside the allowed places references it", () => {
    const offenders = SCAN_DIRS.flatMap((d) => listFiles(join(ROOT, d)))
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .filter((path) => !isAllowedToMention(path))
      .filter((path) => LEFTOVER.test(readFileSync(join(ROOT, path), "utf-8")));

    expect(offenders).toEqual([]);
  });
});
