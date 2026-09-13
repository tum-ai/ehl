/**
 * Blocked submission attempts: the reasons a team clicked Submit and got
 * nothing, and whose problem each one is.
 *
 * Why this exists: a blocked submission writes NO row, so before this it left no
 * trace anywhere. Organizers found out that teams were stuck only when someone
 * walked up to the desk, which during a submission window is far too late. Every
 * gate in submitProject now records an attempt, and the admin view counts them
 * live.
 *
 * The "side" is the operationally important part. A team blocked because they
 * are not checked in is a desk conversation. Several teams blocked by
 * `entire_check_unavailable` is an incident: our own GitHub access is failing
 * and nobody on the floor can fix it by talking to teams.
 */

export const BLOCK_ACTION = "submission.blocked";

export type BlockReason =
  | "not_team_member"
  | "not_checked_in"
  | "not_registered"
  | "submissions_locked"
  | "deadline_passed"
  | "entire_missing"
  | "entire_repo_unreadable"
  | "entire_check_unavailable";

/** Whose problem a reason is. "ours" means no amount of talking to the team helps. */
export type BlockSide = "ours" | "theirs";

const SIDE: Record<BlockReason, BlockSide> = {
  not_team_member: "theirs",
  not_checked_in: "theirs",
  not_registered: "theirs",
  submissions_locked: "theirs",
  deadline_passed: "theirs",
  entire_missing: "theirs",
  entire_repo_unreadable: "theirs",
  // Our GitHub access failed. The team can do nothing, and neither can the desk.
  entire_check_unavailable: "ours",
};

const LABEL: Record<BlockReason, string> = {
  not_team_member: "Not a member of the team",
  not_checked_in: "Not checked in",
  not_registered: "Team not registered for the challenge",
  submissions_locked: "Submissions locked",
  deadline_passed: "Deadline passed",
  entire_missing: "No Entire session record",
  entire_repo_unreadable: "Repository not readable (access or wrong URL)",
  entire_check_unavailable: "Session-record check failed on our side",
};

export function blockSide(reason: BlockReason): BlockSide {
  return SIDE[reason] ?? "theirs";
}

export function blockLabel(reason: BlockReason): string {
  return LABEL[reason] ?? reason;
}

export interface BlockCount {
  reason: BlockReason;
  label: string;
  side: BlockSide;
  count: number;
  /** Distinct teams affected: 5 attempts by one team is not 5 stuck teams. */
  teams: number;
}

export interface BlockSummary {
  windowMinutes: number;
  total: number;
  /** Attempts blocked by something only WE can fix. The number to act on. */
  ourSideTotal: number;
  counts: BlockCount[];
}

/**
 * Roll raw blocked-attempt rows into per-reason counts, most frequent first.
 * Pure so the admin view's arithmetic is testable without a database.
 */
export function summarizeBlocks(
  rows: { reason: string; teamId: string | null }[],
  windowMinutes: number
): BlockSummary {
  const byReason = new Map<string, { count: number; teams: Set<string> }>();

  for (const row of rows) {
    const entry = byReason.get(row.reason) ?? { count: 0, teams: new Set<string>() };
    entry.count++;
    if (row.teamId) entry.teams.add(row.teamId);
    byReason.set(row.reason, entry);
  }

  const counts: BlockCount[] = Array.from(byReason, ([reason, v]) => ({
    reason: reason as BlockReason,
    label: blockLabel(reason as BlockReason),
    side: blockSide(reason as BlockReason),
    count: v.count,
    teams: v.teams.size,
  })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    windowMinutes,
    total: rows.length,
    ourSideTotal: counts
      .filter((c) => c.side === "ours")
      .reduce((sum, c) => sum + c.count, 0),
    counts,
  };
}
