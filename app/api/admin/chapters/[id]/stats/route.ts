import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { getChapterDetailStats } from "@/lib/queries/admin-stats";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Chapter-scoped: global admins pass for any chapter, local admins only for
  // their own. The detail stats (this chapter's application pipeline + per-
  // challenge breakdown) are rendered on the chapter page both roles can open.
  const { id } = await params;
  const denied = await requireChapterAdminApi(id);
  if (denied) return denied;

  const stats = await getChapterDetailStats(id);
  return NextResponse.json(stats);
}
