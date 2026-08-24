import { MIN_TEAM_SIZE } from "@/lib/config/limits";

/**
 * What an admin is actually about to do when they remove a team member.
 *
 * The server no longer refuses a removal that drops a team below MIN_TEAM_SIZE
 * or that targets the captain, so the confirm step is the only place the
 * consequence gets stated. A generic "Are you sure?" would hide exactly the
 * cases worth pausing on, so this names them: who gets promoted, that the team
 * falls below the minimum, or that the team is left empty.
 */

export interface RemovalContext {
  memberName: string;
  teamName: string;
  /** Size of the roster BEFORE the removal. */
  rosterSize: number;
  isCaptain: boolean;
  /** Who inherits the captaincy, when the target is the captain and is not last. */
  successorName: string | null;
}

export interface RemovalConsequence {
  /** Sentences to show in the confirm step, in the order they should be read. */
  lines: string[];
  /** True when the removal is an exception to an ordinary invariant. */
  needsAttention: boolean;
}

export function describeRemoval(ctx: RemovalContext): RemovalConsequence {
  const remaining = Math.max(0, ctx.rosterSize - 1);
  const lines: string[] = [`Remove ${ctx.memberName} from ${ctx.teamName}?`];
  let needsAttention = false;

  if (ctx.isCaptain && remaining > 0) {
    lines.push(
      ctx.successorName
        ? `${ctx.memberName} is the captain. ${ctx.successorName} will be promoted.`
        : `${ctx.memberName} is the captain. Another member will be promoted.`
    );
    needsAttention = true;
  }

  if (remaining === 0) {
    lines.push(
      `This is the last member. ${ctx.teamName} will be left empty, and you can then delete it.`
    );
    needsAttention = true;
  } else if (remaining < MIN_TEAM_SIZE) {
    lines.push(
      `This leaves ${ctx.teamName} with ${remaining} member${remaining === 1 ? "" : "s"}, ` +
        `below the minimum of ${MIN_TEAM_SIZE}.`
    );
    needsAttention = true;
  }

  return { lines, needsAttention };
}

/** Display name for a member row, falling back through profile fields. */
export function memberLabel(member: {
  userId: string;
  profile?: { name?: string | null; email?: string | null };
}): string {
  return member.profile?.name || member.profile?.email || member.userId.slice(0, 8);
}

/**
 * Who the server will promote if this member is removed.
 *
 * MUST mirror adminRemoveMember in lib/actions/admin.ts, which orders the
 * roster by joined_at ascending and promotes the first survivor. If the two
 * ever drift, the confirm step names the wrong person, which is worse than
 * naming nobody, so the rule lives in one tested place.
 */
export function successorLabel(
  members: readonly {
    userId: string;
    joinedAt: string;
    profile?: { name?: string | null; email?: string | null };
  }[],
  removedUserId: string
): string | null {
  const survivors = members
    .filter((m) => m.userId !== removedUserId)
    .sort((a, b) => {
      const byJoined = Date.parse(a.joinedAt || "") - Date.parse(b.joinedAt || "");
      if (!Number.isNaN(byJoined) && byJoined !== 0) return byJoined;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });

  return survivors.length > 0 ? memberLabel(survivors[0]) : null;
}
