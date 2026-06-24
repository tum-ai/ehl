import { NextResponse } from "next/server";
import { downloadFile } from "@/lib/gdrive";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  if (!fileId || fileId.length < 10) {
    return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
  }

  // Resolve which chapter this CV belongs to. The fileId is the Google Drive
  // file id stored as `cv_url` on the owning application row. We scope access to
  // that chapter so a local (chapter) admin can read CVs in their own chapter
  // but never CVs from another chapter. Global admins pass for any chapter.
  const adminClient = createAdminClient();
  const { data: application } = await adminClient
    .from("applications")
    .select("chapter_id")
    .eq("cv_url", fileId)
    .maybeSingle();

  if (!application) {
    // No application owns this file id: there is no chapter to authorize the
    // caller against, so deny rather than expose an arbitrary Drive file.
    return NextResponse.json({ error: "File not found or inaccessible" }, { status: 404 });
  }

  // Chapter-scoped guard: global admins always pass; a chapter admin passes only
  // for their own chapter; everyone else gets 403. Enforced server-side.
  const denied = await requireChapterAdminApi(application.chapter_id as string);
  if (denied) return denied;

  try {
    const { buffer, mimeType } = await downloadFile(fileId);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("CV proxy error:", err);
    return NextResponse.json({ error: "File not found or inaccessible" }, { status: 404 });
  }
}
