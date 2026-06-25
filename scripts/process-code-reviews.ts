/**
 * Process queued code reviews.
 *
 * Designed to run in GitHub Actions (no Vercel timeout constraint).
 * Picks up all code_reviews with status="queued", processes them sequentially,
 * and writes results back to Supabase.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OPENROUTER_API_KEY (fallback if not in app_settings)
 *   GITHUB_TOKEN (fallback if not in app_settings)
 */

import { createClient } from "@supabase/supabase-js";
import { toChallenge } from "../lib/queries";
import { runCodeReviewPipeline } from "../lib/code-review/pipeline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKER_ID = process.env.WORKER_ID ?? "1";

async function main() {
  // This script is designed to run as ONE OF MANY parallel workers (see the
  // matrix in .github/workflows/process-code-reviews.yml). Each iteration claims
  // the next queued review atomically and keeps going until the queue is drained,
  // so the workers self-balance: a fast worker keeps pulling more work instead of
  // sitting idle while others churn. The atomic claim
  // (UPDATE ... WHERE status='queued') guarantees each row is processed once.

  let completed = 0;
  let failed = 0;

  for (;;) {
    // Fetch the oldest still-queued review.
    const { data: candidate, error: fetchError } = await adminClient
      .from("code_reviews")
      .select("id, submission_id")
      .eq("status", "queued")
      .order("generated_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error(`[worker ${WORKER_ID}] Failed to fetch queued reviews:`, fetchError.message);
      process.exit(1);
    }

    if (!candidate) {
      console.log(`[worker ${WORKER_ID}] No more queued code reviews. Done.`);
      break;
    }

    const review = candidate;
    const submissionId = review.submission_id as string;

    // Atomically claim this review (prevents race conditions between workers).
    const { data: claimed } = await adminClient
      .from("code_reviews")
      .update({ status: "processing" })
      .eq("id", review.id)
      .eq("status", "queued")
      .select("id")
      .single();

    if (!claimed) {
      // Another worker grabbed it between our SELECT and UPDATE. Try the next.
      continue;
    }

    console.log(`\n[worker ${WORKER_ID}] Processing review for submission ${submissionId}...`);

    try {
      // Get submission
      const { data: submission } = await adminClient
        .from("submissions")
        .select("*")
        .eq("id", submissionId)
        .single();

      if (!submission) {
        throw new Error("Submission not found");
      }

      // Get challenge
      const { data: challengeRow } = await adminClient
        .from("challenges")
        .select("*")
        .eq("id", submission.challenge_id)
        .single();

      if (!challengeRow) {
        throw new Error("Challenge not found");
      }

      const challenge = toChallenge(challengeRow as Record<string, unknown>);

      // Determine repo URL (prefer fork)
      const fields = (submission.fields as Record<string, string>) ?? {};
      // Check common keys case-insensitively
      const lowerFields = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v])
      );
      const originalRepoUrl =
        lowerFields.repo ||
        lowerFields.github ||
        lowerFields.repository ||
        Object.values(fields).find(
          (v: string) => typeof v === "string" && v.includes("github.com")
        );
      const repoUrl = (submission.fork_url as string) || originalRepoUrl;

      if (!repoUrl) {
        throw new Error("No GitHub repository URL found");
      }

      // Update repo URL on the review record
      await adminClient
        .from("code_reviews")
        .update({ repo_url: repoUrl })
        .eq("id", review.id);

      // Run the multi-agent pipeline with progress tracking
      const result = await runCodeReviewPipeline({
        repoUrl,
        challenge,
        briefText: null, // Brief PDF download requires Google Drive credentials not available in CI
        onProgress: async (step: string) => {
          console.log(`  [${step}]`);
          await adminClient
            .from("code_reviews")
            .update({ progress: step })
            .eq("id", review.id);
        },
      });

      // Store completed review
      await adminClient
        .from("code_reviews")
        .update({
          review_content: result.reviewContent,
          repo_metadata: result.repoMetadata,
          pipeline_log: result.pipelineLog,
          // Also persist the advisory session-history analysis to its own column
          // for easy querying. It is additionally embedded in review_content.
          session_history: result.reviewContent.session_history ?? null,
          model_used: "multi-agent-v2",
          cost_usd: result.costUsd,
          status: "completed",
          review_version: 2,
          generated_at: new Date().toISOString(),
          progress: null,
        })
        .eq("id", review.id);

      completed++;
      console.log(`  Completed. Cost: $${result.costUsd.toFixed(4)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Failed: ${message}`);

      await adminClient
        .from("code_reviews")
        .update({ status: "failed", progress: message })
        .eq("id", review.id);

      failed++;
    }
  }

  console.log(`\nDone. ${completed} completed, ${failed} failed.`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
