import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { toApplication, toApplicationNote } from "@/lib/queries/mappers";

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
  // client renders the full history without a second round trip.
  const { data: noteRows } = await adminClient
    .from("application_notes")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    ...toApplication(data),
    notes: (noteRows ?? []).map(toApplicationNote),
  });
}
