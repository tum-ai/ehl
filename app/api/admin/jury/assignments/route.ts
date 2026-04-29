import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();

  const { data } = await adminClient
    .from("jury_assignments")
    .select("user_id, challenge_id, chapter_id, status");

  return NextResponse.json(
    (data ?? []).map((row) => ({
      userId: row.user_id,
      challengeId: row.challenge_id,
      chapterId: row.chapter_id,
      status: row.status ?? "pending",
    }))
  );
}
