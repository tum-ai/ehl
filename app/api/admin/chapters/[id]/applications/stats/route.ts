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
    .from("applications")
    .select("status")
    .eq("chapter_id", id);

  const rows = data ?? [];
  const stats = {
    total: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    accepted: rows.filter((r) => r.status === "accepted").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    waitlisted: rows.filter((r) => r.status === "waitlisted").length,
    checkedIn: rows.filter((r) => r.status === "checked_in").length,
  };

  return NextResponse.json(stats);
}
