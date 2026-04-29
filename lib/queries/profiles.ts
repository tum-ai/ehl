import type { Profile } from "../types";
import { createAdminClient } from "../supabase/admin";
import { toProfile } from "./mappers";

/**
 * Get a profile by user ID. Uses admin client because the profiles table
 * RLS restricts anonymous reads to prevent email enumeration (F02 fix).
 * This is safe: read-only query, only exposes fields via toProfile() mapper,
 * and is only called from Server Components (team page).
 */
export async function getProfile(
  userId: string
): Promise<Profile | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, name, looking_for_team")
    .eq("id", userId)
    .single();
  if (!data) return null;
  return {
    id: data.id as string,
    name: (data.name as string) ?? null,
    email: null, // Never expose email in public queries
    role: "participant",
    lookingForTeam: (data.looking_for_team as boolean) ?? false,
  };
}
