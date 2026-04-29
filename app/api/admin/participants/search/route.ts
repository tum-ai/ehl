import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Search participants (applicants) across all chapters by name or email.
 * Returns deduplicated results (by email) with form data for flag creation.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const adminClient = createAdminClient();
  const pattern = `%${q}%`;

  const { data, error } = await adminClient
    .from("applications")
    .select("email, first_name, last_name, form_data")
    .or(`email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Deduplicate by email (keep the most recent application per email)
  const seen = new Set<string>();
  const results: { email: string; firstName: string; lastName: string; linkedIn: string | null; github: string | null }[] = [];

  for (const row of data ?? []) {
    const email = (row.email as string).toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);

    const fd = row.form_data as Record<string, unknown> | null;
    results.push({
      email: row.email as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      linkedIn: (fd?.linkedIn as string) ?? null,
      github: (fd?.github as string) ?? null,
    });

    if (results.length >= 15) break;
  }

  return NextResponse.json(results);
}
