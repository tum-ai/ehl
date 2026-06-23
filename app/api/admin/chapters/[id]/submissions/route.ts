import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chapterId } = await params;
  const denied = await requireChapterAdminApi(chapterId);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const challengeId = searchParams.get("challengeId");

  const adminClient = createAdminClient();
  let query = adminClient.from("submissions").select("*");

  if (challengeId) {
    // Verify the challenge belongs to this chapter before querying submissions.
    const { data: challenge } = await adminClient
      .from("challenges")
      .select("id")
      .eq("id", challengeId)
      .eq("chapter_id", chapterId)
      .single();
    if (!challenge) return NextResponse.json([], { status: 200 });

    query = query.eq("challenge_id", challengeId);
  } else {
    // Get all submissions for challenges in this chapter
    const { data: challenges } = await adminClient
      .from("challenges")
      .select("id")
      .eq("chapter_id", chapterId);

    if (!challenges || challenges.length === 0) {
      return NextResponse.json([]);
    }

    query = query.in(
      "challenge_id",
      challenges.map((c) => c.id)
    );
  }

  const { data } = await query;

  // Map to camelCase to match frontend expectations
  const submissions = (data ?? []).map((row) => ({
    id: row.id,
    challengeId: row.challenge_id,
    teamId: row.team_id,
    projectName: row.project_name,
    shortDescription: row.short_description,
    fields: row.fields ?? {},
    techStack: row.tech_stack ?? [],
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
    isLocked: row.is_locked ?? false,
    forkUrl: row.fork_url ?? null,
  }));

  return NextResponse.json(submissions);
}
