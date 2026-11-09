import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getChapterDetailStats } from "@/lib/queries/admin-stats";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // The detail stats (this chapter's application pipeline + per-challenge
  // breakdown) are rendered on the chapter page.
  const { id } = await params;
  const denied = await requireAdmin();
  if (denied) return denied;

  const stats = await getChapterDetailStats(id);
  return NextResponse.json(stats);
}
