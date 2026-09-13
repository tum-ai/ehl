import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { BLOCK_ACTION, summarizeBlocks, type BlockSummary } from "@/lib/submission-blocks";

/**
 * Blocked submission attempts for one chapter over a recent rolling window.
 *
 * Reads the append-only event_log (no new table): submitProject records every
 * refused attempt there, and `event_log` is already indexed on both `action` and
 * `created_at`. Admin client because event_log is admin-only; the CALLER must
 * have passed requireChapterAdminApi / requireAdmin first.
 */
export async function getSubmissionBlocks(
  chapterId: string,
  windowMinutes = 60
): Promise<BlockSummary> {
  const admin = createAdminClient();

  const { data: challenges } = await admin
    .from("challenges")
    .select("id")
    .eq("chapter_id", chapterId);

  const challengeIds = (challenges ?? []).map((c) => c.id as string);
  if (challengeIds.length === 0) return summarizeBlocks([], windowMinutes);

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { data } = await admin
    .from("event_log")
    .select("entity_id, delta, created_at")
    .eq("action", BLOCK_ACTION)
    .in("entity_id", challengeIds)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(QUERY_LIMITS.submissionBlocks);

  const rows = (data ?? []).map((row) => {
    const blocked = (row.delta as { blocked?: { reason?: string; team_id?: string } })?.blocked;
    return {
      reason: blocked?.reason ?? "unknown",
      teamId: blocked?.team_id ?? null,
    };
  });

  return summarizeBlocks(rows, windowMinutes);
}
