import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, relative } from "path";

/**
 * Static guard for the `.single()` multi-row class (CLAUDE.md, Data Integrity 7).
 *
 * A user can hold SEVERAL `team_members` rows: migration 00024 dropped the
 * global unique index on `team_members(user_id)`, and the 00035 trigger only
 * forbids a second team while the first is registered for a non-completed
 * chapter. PostgREST then rejects `.single()` / `.maybeSingle()` on the
 * multi-row result and supabase-js hands back `data: null`, which is
 * indistinguishable from "no row". Every caller reads that as absence and
 * reports a confident falsehood ("you are not on a team"). `.limit(1).single()`
 * is worse: it succeeds and returns an ARBITRARY row.
 *
 * That is what emptied the dashboard for everyone who had ever changed teams.
 * The fix is `lib/team-membership.ts`; this test is what stops the pattern from
 * growing back, since the broken version looks completely ordinary in review.
 *
 * Filtering on `team_id` AND `user_id` is fine: that pair matches at most one
 * row, so those chains are allowed.
 */

const ROOTS = ["lib", "app"];
const SOURCE_RE = /\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (SOURCE_RE.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Slice out each `.from("team_members")` query chain: from that call up to and
 * including the terminating `.single()` / `.maybeSingle()`, or to the end of
 * the statement if it terminates some other way.
 */
function teamMemberChains(source: string): string[] {
  const chains: string[] = [];
  const re = /\.from\(\s*["']team_members["']\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    const rest = source.slice(match.index);
    // A chain ends at the first single/maybeSingle, or at a blank line, which
    // is far enough to see every filter without swallowing the next query.
    const terminator = rest.search(/\.(maybeSingle|single)\(\s*\)|\n\s*\n/);
    chains.push(terminator === -1 ? rest.slice(0, 400) : rest.slice(0, terminator + 20));
  }
  return chains;
}

function isRisky(chain: string): boolean {
  const terminatesSingle = /\.(maybeSingle|single)\(\s*\)/.test(chain);
  if (!terminatesSingle) return false;

  const filtersUser = /\.eq\(\s*["']user_id["']/.test(chain);
  if (!filtersUser) return false;

  // team_id + user_id is a unique pair: at most one row, so `.single()` is safe.
  const filtersTeam = /\.eq\(\s*["']team_id["']/.test(chain);
  return !filtersTeam;
}

describe("team_members lookups never assume a single row per user", () => {
  it("has no .eq(user_id) chain terminating in .single()/.maybeSingle()", () => {
    const repoRoot = resolve(__dirname, "..");
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(resolve(repoRoot, root))) {
        for (const chain of teamMemberChains(readFileSync(file, "utf-8"))) {
          if (isRisky(chain)) offenders.push(relative(repoRoot, file));
        }
      }
    }

    // Use getCurrentMembership() / getLockingTeamId() from lib/team-membership.ts
    // instead, or add .eq("team_id", ...) if the lookup really is team-scoped.
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it("recognizes the risky shape it is meant to catch", () => {
    const risky = `.from("team_members").select("team_id").eq("user_id", id).single()`;
    expect(teamMemberChains(risky).some(isRisky)).toBe(true);

    const riskyLimited = `.from("team_members").select("team_id").eq("user_id", id).limit(1).single()`;
    expect(teamMemberChains(riskyLimited).some(isRisky)).toBe(true);

    const riskyMaybe = `.from("team_members").select("team_id").eq("user_id", id).maybeSingle()`;
    expect(teamMemberChains(riskyMaybe).some(isRisky)).toBe(true);
  });

  it("does not flag team-scoped lookups or multi-row reads", () => {
    const teamScoped = `.from("team_members").select("*").eq("team_id", t).eq("user_id", u).single()`;
    expect(teamMemberChains(teamScoped).some(isRisky)).toBe(false);

    const multiRow = `.from("team_members").select("team_id, role").eq("user_id", id)`;
    expect(teamMemberChains(multiRow).some(isRisky)).toBe(false);

    const otherTable = `.from("applications").select("*").eq("user_id", id).single()`;
    expect(teamMemberChains(otherTable).some(isRisky)).toBe(false);
  });
});
