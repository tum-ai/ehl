import { NextResponse } from "next/server";
import { toCodeReview } from "@/lib/queries";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { submissionId } = await params;
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("code_reviews")
    .select("*")
    .eq("submission_id", submissionId)
    .single();

  if (!data) {
    return NextResponse.json(null);
  }
  return NextResponse.json(toCodeReview(data as Record<string, unknown>));
}
