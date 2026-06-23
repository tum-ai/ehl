import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireChapterAdminApi } from "@/lib/admin-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireChapterAdminApi(id);
  if (denied) return denied;
  const adminClient = createAdminClient();

  const { data } = await adminClient
    .from("chapters")
    .select("id, name, status, code_review_enabled")
    .eq("id", id)
    .single();

  if (!data) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    id: data.id,
    name: data.name,
    status: data.status,
    codeReviewEnabled: data.code_review_enabled,
  });
}
