import { NextResponse } from "next/server";
import { toChallenge } from "@/lib/queries";
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
    .from("challenges")
    .select("*")
    .eq("chapter_id", id)
    .order("display_order");

  return NextResponse.json((data ?? []).map((row) => toChallenge(row as Record<string, unknown>)));
}
