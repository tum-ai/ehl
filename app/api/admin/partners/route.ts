import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toPartner } from "@/lib/queries";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("partners")
    .select("*")
    .order("display_order");

  return NextResponse.json((data ?? []).map((row) => toPartner(row as Record<string, unknown>)));
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json();
  const { name, logoUrl, url, tier, description } = body;

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

  const { data, error } = await adminClient
    .from("partners")
    .insert({
      name,
      logo_url: logoUrl,
      url: url || "",
      tier: tier || "challenge_partner",
      description: description || null,
      display_order: nextOrder,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    partner: {
      id: data.id,
      name: data.name,
      logoUrl: data.logo_url,
      url: data.url,
      tier: data.tier,
      description: data.description,
      displayOrder: data.display_order,
      chapterId: data.chapter_id,
    },
  });
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
