import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/actions/auth";
import { toChallenge, toSubmission } from "@/lib/queries";
import { runCodeReviewPipeline } from "@/lib/code-review/pipeline";
import { downloadFile } from "@/lib/gdrive";
import { selectSubmissionRepository } from "@/lib/submission-snapshots/selection";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { submissionId } = body;

  if (!submissionId) {
    return NextResponse.json({ error: "submissionId required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Get submission
  const { data: submission } = await adminClient
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  // Get challenge info
  const { data: challengeRow } = await adminClient
    .from("challenges")
    .select("*")
    .eq("id", submission.challenge_id)
    .single();

  if (!challengeRow) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  const challenge = toChallenge(challengeRow as Record<string, unknown>);

  const mappedSubmission = toSubmission(submission);
  const selected = selectSubmissionRepository(mappedSubmission, challenge.submissionFields);
  if (!selected) {
    return NextResponse.json(
      { error: mappedSubmission.submissionRevision ? "The accepted repository version is unavailable." : "No GitHub repository URL found" },
      { status: mappedSubmission.submissionRevision ? 409 : 400 }
    );
  }
  const { repoUrl, commitSha, checkpointRefs } = selected;

  // Keep this attempt's row identity: a new receipt deletes stale reviews, so a
  // late completion must never update a replacement row by submission_id.
  const { data: review, error: startError } = await adminClient.from("code_reviews").upsert(
    {
      id: randomUUID(),
      submission_id: submissionId,
      repo_url: repoUrl,
      status: "processing",
      review_content: null,
      model_used: null,
      repo_metadata: null,
      pipeline_log: null,
      review_version: 2,
      cost_usd: null,
    },
    { onConflict: "submission_id" }
  ).select("id").single();
  if (startError || !review) {
    return NextResponse.json({ error: "Could not start the code review." }, { status: 500 });
  }

  // Covers a receipt arriving between the initial read and this attempt's
  // creation. Changes after this check delete the row we retained above.
  const { data: current, error: currentError } = await adminClient.from("submissions")
    .select("submission_revision").eq("id", submissionId).single();
  if (currentError || !current || (current.submission_revision ?? 0) !== (mappedSubmission.submissionRevision ?? 0)) {
    await adminClient.from("code_reviews").update({ status: "failed", progress: "Submission changed. Retry the review." }).eq("id", review.id);
    return NextResponse.json({ error: "Submission changed. Please retry the review." }, { status: 409 });
  }

  try {
    // Fetch brief PDF content if available
    let briefText: string | null = null;
    if (challenge.briefFileId) {
      try {
        const { buffer } = await downloadFile(challenge.briefFileId);
        // Pass as base64 for models that support document input
        // For text-based models, the prompts will handle this appropriately
        briefText = `[PDF document, ${Math.round(buffer.length / 1024)}KB, base64-encoded]\n${buffer.toString("base64")}`;
      } catch {
        // Brief fetch failure should not block the review
      }
    }

    // Run multi-agent pipeline
    const result = await runCodeReviewPipeline({
      repoUrl,
      commitSha,
      checkpointRefs,
      challenge,
      briefText,
    });

    // Store completed review
    const { data: completed, error: completionError } = await adminClient
      .from("code_reviews")
      .update({
        review_content: result.reviewContent,
        repo_metadata: result.repoMetadata,
        pipeline_log: result.pipelineLog,
        model_used: "multi-agent-v2",
        cost_usd: result.costUsd,
        status: "completed",
        review_version: 2,
        generated_at: new Date().toISOString(),
      })
      .eq("id", review.id).select("id").maybeSingle();
    if (completionError) throw completionError;
    if (!completed) {
      return NextResponse.json({ error: "Submission or review changed. Please refresh." }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      review: result.reviewContent,
    });
  } catch (err) {
    console.error("Code review pipeline failed:", err);

    await adminClient
      .from("code_reviews")
      .update({ status: "failed" })
      .eq("id", review.id);

    return NextResponse.json({ error: "Code review failed. Please try again." }, { status: 500 });
  }
}
