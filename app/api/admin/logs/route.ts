import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50")));
  const action = searchParams.get("action");
  const entityType = searchParams.get("entity_type");
  const actorType = searchParams.get("actor_type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const adminClient = createAdminClient();

  let query = adminClient
    .from("event_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (action) query = query.ilike("action", `%${action}%`);
  if (entityType) query = query.eq("entity_type", entityType);
  if (actorType) query = query.eq("actor_type", actorType);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data: entries, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich with actor names
  const actorIds = [...new Set((entries ?? []).filter(e => e.actor_id).map(e => e.actor_id as string))];
  let actorNames: Record<string, string> = {};
  if (actorIds.length > 0) {
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id, name, email")
      .in("id", actorIds);
    if (profiles) {
      actorNames = Object.fromEntries(profiles.map(p => [p.id, p.name || p.email || "Unknown"]));
    }
  }

  const enriched = (entries ?? []).map(entry => ({
    ...entry,
    actor_name: entry.actor_id ? (actorNames[entry.actor_id as string] ?? null) : null,
  }));

  return NextResponse.json({
    entries: enriched,
    total: count ?? 0,
    page,
    limit,
  });
}
