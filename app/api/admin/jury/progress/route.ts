import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();

  // Get all assignments with user info
  const { data: assignments } = await adminClient
    .from("jury_assignments")
    .select("user_id, challenge_id, chapter_id, status");

  // Get challenge finalization status
  const { data: challenges } = await adminClient
    .from("challenges")
    .select("id, jury_finalized_at, jury_finalized_by");

  // Get profiles for jury users
  const userIds = [...new Set((assignments ?? []).map((a) => a.user_id))];
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id, name, email")
    .in("id", userIds.length > 0 ? userIds : ["none"]);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, { name: p.name, email: p.email }])
  );

  const finalizedMap = new Map(
    (challenges ?? []).map((c) => [c.id, {
      finalizedAt: c.jury_finalized_at,
      finalizedBy: c.jury_finalized_by,
    }])
  );

  // Group by challenge
  const progressByChallenge: Record<string, {
    chapterId: string;
    finalized: boolean;
    finalizedAt: string | null;
    jurors: Array<{
      userId: string;
      name: string | null;
      email: string | null;
      status: string;
    }>;
  }> = {};

  for (const a of assignments ?? []) {
    const challengeId = a.challenge_id as string;
    if (!progressByChallenge[challengeId]) {
      const fin = finalizedMap.get(challengeId);
      progressByChallenge[challengeId] = {
        chapterId: a.chapter_id as string,
        finalized: !!fin?.finalizedAt,
        finalizedAt: (fin?.finalizedAt as string) ?? null,
        jurors: [],
      };
    }
    const profile = profileMap.get(a.user_id as string);
    progressByChallenge[challengeId].jurors.push({
      userId: a.user_id as string,
      name: (profile?.name as string) ?? null,
      email: (profile?.email as string) ?? null,
      status: (a.status as string) ?? "pending",
    });
  }

  return NextResponse.json(progressByChallenge);
}
