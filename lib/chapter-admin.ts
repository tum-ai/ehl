import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns the chapter a local (chapter) admin is assigned to, or null if the
 * user has no chapter_admins assignment. Local admins are scoped to a single
 * chapter, so we return the first assignment.
 *
 * Uses the admin client (service role) so it can run inside server guards
 * regardless of the caller's RLS context.
 */
export async function getAdminChapterId(userId: string): Promise<string | null> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("chapter_admins")
    .select("chapter_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data?.chapter_id as string | undefined) ?? null;
}
