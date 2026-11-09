import { NextResponse } from "next/server";
import { downloadFile } from "@/lib/gdrive";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  if (!fileId || fileId.length < 10) {
    return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
  }

  // Admin check before any DB work: an unauthenticated caller must not be able
  // to force a lookup and distinguish owned from orphan file ids.
  const denied = await requireAdmin();
  if (denied) return denied;

  // Only serve a Drive file that is actually a CV: the fileId must be the
  // `cv_url` of an application row, so this route cannot expose an arbitrary
  // Drive file.
  const adminClient = createAdminClient();
  const { data: application } = await adminClient
    .from("applications")
    .select("id")
    .eq("cv_url", fileId)
    .maybeSingle();

  if (!application) {
    return NextResponse.json({ error: "File not found or inaccessible" }, { status: 404 });
  }

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
