import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";

// Teams registered for THIS chapter, with the challenge they registered for.
// Powers the manual-results flow on the admin scores page: with no jury votes
// and no prior scores, this is the roster an admin enters the final ranking
// against (and each team's registered challenge pre-fills the score's
// challenge assignment). Global-admin only, like every other scores API.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id: chapterId } = await params;
  const adminClient = createAdminClient();

  const { data: registrations, error } = await adminClient
    .from("challenge_registrations")
    .select("team_id, challenge_id")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.challengeRegistrations);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    (registrations ?? []).map((r) => ({
      teamId: r.team_id as string,
      challengeId: (r.challenge_id as string) ?? null,
    }))
  );
}
