import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/actions/auth";
import { toChallenge } from "@/lib/queries";
import { runCodeReviewPipeline } from "@/lib/code-review/pipeline";
import { downloadFile } from "@/lib/gdrive";

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

  // Prefer fork URL (EHL's frozen copy), fall back to original repo
  const fields = submission.fields as Record<string, string>;
  const originalRepoUrl =
    fields.repo ||
    fields.github ||
    fields.repository ||
    Object.values(fields).find(
      (v: string) => typeof v === "string" && v.includes("github.com")
    );
  const repoUrl = (submission.fork_url as string) || originalRepoUrl;

  if (!repoUrl) {
    return NextResponse.json(
      { error: "No GitHub repository URL found" },
      { status: 400 }
    );
  }

  // Mark as processing
  await adminClient.from("code_reviews").upsert(
    {
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
  );

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
      challenge,
      briefText,
    });

    // Store completed review
    await adminClient
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
      .eq("submission_id", submissionId);

    return NextResponse.json({
      success: true,
      review: result.reviewContent,
    });
  } catch (err) {
    console.error("Code review pipeline failed:", err);

    await adminClient
      .from("code_reviews")
      .update({ status: "failed" })
      .eq("submission_id", submissionId);

    return NextResponse.json({ error: "Code review failed. Please try again." }, { status: 500 });
  }
}
