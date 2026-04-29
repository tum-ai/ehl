import { NextResponse } from "next/server";
import { toScore } from "@/lib/queries";
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
    .from("scores")
    .select("*")
    .eq("chapter_id", id)
    .order("placement", { ascending: true, nullsFirst: false });
  return NextResponse.json((data ?? []).map((row) => toScore(row as Record<string, unknown>)));
}
