import { NextRequest, NextResponse } from "next/server";
import { getViewLink } from "@/lib/gdrive";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const fileId = request.nextUrl.searchParams.get("path");
  if (!fileId) {
    return NextResponse.json({ error: "Missing file ID" }, { status: 400 });
  }

  return NextResponse.redirect(getViewLink(fileId));
}
