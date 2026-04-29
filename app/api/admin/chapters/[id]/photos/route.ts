import { NextResponse } from "next/server";
import { toMediaItem } from "@/lib/queries";
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
    .from("media")
    .select("*")
    .eq("chapter_id", id)
    .order("featured", { ascending: false });

  const media = (data ?? []).map((row) => toMediaItem(row as Record<string, unknown>));
  const photos = media
    .filter((m) => m.type === "photo")
    .map((m) => ({
      id: m.id,
      url: m.url,
      caption: m.caption,
      featured: m.featured,
    }));

  return NextResponse.json(photos);
}
