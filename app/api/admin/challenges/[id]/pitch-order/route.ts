import { NextResponse } from "next/server";
import { toPitchOrder } from "@/lib/queries";
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
    .from("pitch_orders")
    .select("*")
    .eq("challenge_id", id)
    .single();

  if (!data) {
    return NextResponse.json(null);
  }
  return NextResponse.json(toPitchOrder(data as Record<string, unknown>));
}
