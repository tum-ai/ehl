import { NextResponse } from "next/server";
import { toChapter } from "@/lib/queries";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("chapters")
    .select("*")
    .order("match_number");

  const chapters = (data ?? []).map((row) => toChapter(row as Record<string, unknown>));
  return NextResponse.json(
    chapters.map((ch) => ({ id: ch.id, name: ch.name, status: ch.status }))
  );
}
