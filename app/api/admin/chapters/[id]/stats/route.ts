import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getChapterDetailStats } from "@/lib/queries/admin-stats";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const stats = await getChapterDetailStats(id);
  return NextResponse.json(stats);
}
