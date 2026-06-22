import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { toApplication, toApplicationNote } from "@/lib/queries/mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; applicationId: string }> }
) {
  const { id, applicationId } = await params;
  const denied = await requireChapterAdminApi(id);
  if (denied) return denied;

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .eq("chapter_id", id)
    .single();

  if (!data) {
    return NextResponse.json(null, { status: 404 });
  }

  // Notes are part of the detail view; fetch them in the same request so the
  // client renders the full history without a second round trip. Capped via
  // QUERY_LIMITS per repo convention; notes per application are admin-authored
  // and tiny, so the cap is a safety bound rather than a practical limit.
  const { data: noteRows } = await adminClient
    .from("application_notes")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true })
    .limit(QUERY_LIMITS.applicationNotes);

  return NextResponse.json({
    ...toApplication(data),
    notes: (noteRows ?? []).map(toApplicationNote),
  });
}
