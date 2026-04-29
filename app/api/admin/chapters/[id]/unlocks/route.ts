import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("chapter_unlocks")
    .select("*")
    .eq("chapter_id", id);

  return NextResponse.json(
    (data ?? []).map((row) => ({
      chapterId: row.chapter_id as string,
      teamId: row.team_id as string,
      unlockedAt: row.unlocked_at as string,
      unlockedBy: (row.unlocked_by as string) ?? null,
    }))
  );
}
