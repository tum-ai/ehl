import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Look up check-in status for a list of users at a specific chapter.
 *
 * Lookup chain: user_id -> profiles.email -> applications(chapter_id, email).status
 * Uses adminClient because this crosses RLS boundaries (same pattern as getEventStatus).
 */
export async function getCheckinStatusForUsers(
  userIds: string[],
  chapterId: string
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (userIds.length === 0) return result;

  const adminClient = createAdminClient();

  // Get emails for all user IDs
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, email")
    .in("id", userIds);

  if (!profiles || profiles.length === 0) {
    for (const id of userIds) result.set(id, false);
    return result;
  }

  const emailToUserId = new Map<string, string>();
  for (const p of profiles) {
    emailToUserId.set(p.email as string, p.id as string);
  }

  // Get application statuses for these emails at this chapter
  const { data: applications } = await adminClient
    .from("applications")
    .select("email, status")
    .eq("chapter_id", chapterId)
    .in("email", [...emailToUserId.keys()]);

  const checkedInEmails = new Set<string>();
  for (const app of applications ?? []) {
    if (app.status === "checked_in") {
      checkedInEmails.add(app.email as string);
    }
  }

  // Build result map
  for (const userId of userIds) {
    const profile = profiles.find((p) => p.id === userId);
    if (!profile) {
      result.set(userId, false);
      continue;
    }
    result.set(userId, checkedInEmails.has(profile.email as string));
  }

  return result;
}
