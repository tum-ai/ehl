"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/actions/auth";

async function requireAdminWithUser() {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return { error: "Admin access required." };
  }
  return { userId: session.user.id };
}

export async function uploadTumaiMembers(
  members: { email: string; name: string | null }[]
) {
  const auth = await requireAdminWithUser();
  if ("error" in auth) return { error: auth.error };

  const adminClient = createAdminClient();

  // Truncate existing
  await adminClient.from("tumai_members").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // Insert new
  const rows = members.map((m) => ({
    email: m.email.toLowerCase().trim(),
    name: m.name?.trim() || null,
    uploaded_by: auth.userId,
  }));

  if (rows.length === 0) {
    return { error: "No valid entries found in CSV." };
  }

  const { error } = await adminClient.from("tumai_members").insert(rows);

  if (error) {
    return { error: error.message };
  }

  return { success: true, count: rows.length };
}

export async function getTumaiMembers(): Promise<
  { email: string; name: string | null }[]
> {
  const auth = await requireAdminWithUser();
  if ("error" in auth) return [];

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("tumai_members")
    .select("email, name")
    .order("email");

  return (data ?? []).map((r) => ({
    email: r.email as string,
    name: (r.name as string) ?? null,
  }));
}

export async function getTumaiMemberCount(): Promise<number> {
  const auth = await requireAdminWithUser();
  if ("error" in auth) return 0;

  const adminClient = createAdminClient();
  const { count } = await adminClient
    .from("tumai_members")
    .select("id", { count: "exact", head: true });

  return count ?? 0;
}
