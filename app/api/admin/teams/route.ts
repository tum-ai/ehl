import { NextResponse } from "next/server";
import { toTeam } from "@/lib/queries";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("teams")
    .select("*")
    .order("name");

  const teams = (data ?? []).map((row) => toTeam(row as Record<string, unknown>));
  return NextResponse.json(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      university: t.university,
      city: t.city,
    }))
  );
}
