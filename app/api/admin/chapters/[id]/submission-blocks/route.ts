import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { getSubmissionBlocks } from "@/lib/queries/submission-blocks";

// Live during a submission window, so never serve a cached answer: a stale
// "0 blocked" is worse than no panel at all.
export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 24 * 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireChapterAdminApi(id);
  if (denied) return denied;

  // Clamp rather than trust: the window reaches a timestamp filter.
  const raw = parseInt(new URL(request.url).searchParams.get("minutes") ?? "", 10);
  const windowMinutes =
    Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_WINDOW_MINUTES) : DEFAULT_WINDOW_MINUTES;

  const summary = await getSubmissionBlocks(id, windowMinutes);
  return NextResponse.json(summary);
}
