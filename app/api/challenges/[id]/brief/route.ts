import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import { downloadFile } from "@/lib/gdrive";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Any logged-in user can view challenge briefs
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id } = await params;

  // Look up the challenge to get the brief_file_id (RLS: public read for non-draft chapters)
  const supabase = await createClient();
  const { data: challenge } = await supabase
    .from("challenges")
    .select("brief_file_id")
    .eq("id", id)
    .single();

  if (!challenge?.brief_file_id) {
    return NextResponse.json({ error: "No brief available" }, { status: 404 });
  }

  try {
    const { buffer, mimeType } = await downloadFile(challenge.brief_file_id);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Brief proxy error:", err);
    return NextResponse.json({ error: "File not found or inaccessible" }, { status: 404 });
  }
}
