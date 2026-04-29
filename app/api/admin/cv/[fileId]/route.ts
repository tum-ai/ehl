import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import { downloadFile } from "@/lib/gdrive";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { fileId } = await params;

  if (!fileId || fileId.length < 10) {
    return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
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
