import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();

  const { data } = await adminClient
    .from("profiles")
    .select("id, name, email, role")
    .eq("role", "jury")
    .order("name");

  return NextResponse.json(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
    }))
  );
}
