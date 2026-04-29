import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";

const MAX_QUEUED_REVIEWS = QUERY_LIMITS.codeReviewQueueDepth;

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json();
  const { submissionIds, dispatch } = body as {
    submissionIds: string[];
    dispatch?: boolean;
  };

  if (!submissionIds || submissionIds.length === 0) {
    return NextResponse.json(
      { error: "submissionIds required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Check current queue depth to prevent unbounded queuing
  const { count } = await adminClient
    .from("code_reviews")
    .select("*", { count: "exact", head: true })
    .in("status", ["queued", "processing"]);

  const currentQueued = count ?? 0;
  if (currentQueued + submissionIds.length > MAX_QUEUED_REVIEWS) {
    return NextResponse.json(
      { error: `Queue limit reached. ${currentQueued} reviews already queued/processing (max ${MAX_QUEUED_REVIEWS}).` },
      { status: 429 }
    );
  }

  let queued = 0;

  for (const submissionId of submissionIds) {
    const { error } = await adminClient.from("code_reviews").upsert(
      {
        submission_id: submissionId,
        status: "queued",
        review_version: 2,
      },
      { onConflict: "submission_id" }
    );

    if (!error) queued++;
  }

  // Dispatch GitHub Actions workflow to process queued reviews
  if (dispatch !== false && queued > 0) {
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;

    if (githubToken && githubRepo) {
      try {
        await fetch(
          `https://api.github.com/repos/${githubRepo}/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
            },
            body: JSON.stringify({
              event_type: "process-code-reviews",
            }),
          }
        );
      } catch {
        // Dispatch failure is non-fatal, reviews can be processed manually
      }
    }
  }

  return NextResponse.json({ success: true, queued });
}
