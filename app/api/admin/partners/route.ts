import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toPartner } from "@/lib/queries";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();
  const [{ data: partnersData }, { data: chaptersData }] = await Promise.all([
    adminClient
      .from("partners")
      .select("*")
      .order("display_order"),
    adminClient
      .from("chapters")
      .select("id, name, city, match_number, is_finale")
      .order("match_number"),
  ]);

  return NextResponse.json({
    partners: (partnersData ?? []).map((row) => toPartner(row as Record<string, unknown>)),
    chapters: (chaptersData ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city,
      matchNumber: c.match_number,
      isFinale: c.is_finale,
    })),
  });
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json();
  const { name, logoUrl, url, tier, description, chapterIds } = body;

  if (!name || !logoUrl) {
    return NextResponse.json({ error: "Name and logo are required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Get max display order
  const { data: existing } = await adminClient
    .from("partners")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1);

  const nextOrder = existing?.[0]?.display_order
    ? (existing[0].display_order as number) + 1
    : 0;

  // If chapterIds provided, create one row per chapter. Otherwise create one global row.
  const ids: (string | null)[] =
    Array.isArray(chapterIds) && chapterIds.length > 0
      ? chapterIds
      : [null];

  const rows = ids.map((chapterId, i) => ({
    name,
    logo_url: logoUrl,
    url: url || "",
    tier: tier || "challenge_partner",
    description: description || null,
    display_order: nextOrder + i,
    chapter_id: chapterId,
  }));

  const { data, error } = await adminClient
    .from("partners")
    .insert(rows)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const partners = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    url: row.url,
    tier: row.tier,
    description: row.description,
    displayOrder: row.display_order,
    chapterId: row.chapter_id,
  }));

  return NextResponse.json({ partners });
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing partner ID" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("partners")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
