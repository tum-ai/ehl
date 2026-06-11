import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { lockSubmissionsCore } from "@/lib/submissions-lock";

// Called by Vercel cron or external scheduler to auto-close applications/challenge selection
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access (timing-safe comparison)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, "utf8");
  const actual = Buffer.from(authHeader, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const now = new Date().toISOString();
  const transitions: string[] = [];

  // Auto-close applications: applications_open -> screening
  const { data: appChapters } = await adminClient
    .from("chapters")
    .select("id, name, application_deadline")
    .eq("status", "applications_open")
    .not("application_deadline", "is", null)
    .lte("application_deadline", now);

  for (const chapter of appChapters ?? []) {
    await adminClient
      .from("chapters")
      .update({ status: "preparation" })
      .eq("id", chapter.id);
    transitions.push(`${chapter.name}: applications_open -> screening`);
  }

  // Auto-close challenge selection: registration_open -> submissions_open
  const { data: csChapters } = await adminClient
    .from("chapters")
    .select("id, name, challenge_selection_deadline")
    .eq("status", "challenge_selection")
    .not("challenge_selection_deadline", "is", null)
    .lte("challenge_selection_deadline", now);

  for (const chapter of csChapters ?? []) {
    await adminClient
      .from("chapters")
      .update({ status: "submissions_open" })
      .eq("id", chapter.id);
    transitions.push(`${chapter.name}: registration_open -> submissions_open`);
  }

  // Auto-lock submissions when deadline passes
  const { data: deadlineChapters } = await adminClient
    .from("chapters")
    .select("id, name, submission_deadline")
    .eq("status", "submissions_open")
    .not("submission_deadline", "is", null)
    .lte("submission_deadline", now);

  let reviewsQueued = 0;

  for (const chapter of deadlineChapters ?? []) {
    // Get all challenges for this chapter
    const { data: challenges } = await adminClient
      .from("challenges")
      .select("id, code_review_enabled")
      .eq("chapter_id", chapter.id);

    for (const challenge of challenges ?? []) {
      // lockSubmissionsCore handles forking+syncing+jury access (no session auth needed for cron)
      await lockSubmissionsCore(challenge.id);

      // Queue code reviews for challenges with review enabled
      if (challenge.code_review_enabled) {
        const { data: submissions } = await adminClient
          .from("submissions")
          .select("id, fields, fork_url")
          .eq("challenge_id", challenge.id);

        for (const sub of submissions ?? []) {
          const fields = (sub.fields as Record<string, string>) ?? {};
          const hasRepo =
            sub.fork_url ||
            Object.values(fields).some(
              (v) => typeof v === "string" && v.includes("github.com")
            );

          if (hasRepo) {
            await adminClient.from("code_reviews").upsert(
              {
                submission_id: sub.id,
                status: "queued",
                review_version: 2,
              },
              { onConflict: "submission_id", ignoreDuplicates: true }
            );
            reviewsQueued++;
          }
        }
      }
    }

    // Advance status to pitching
    await adminClient
      .from("chapters")
      .update({ status: "pitching" })
      .eq("id", chapter.id);
    transitions.push(`${chapter.name}: submissions_open -> pitching`);
  }

  // Dispatch GitHub Actions workflow if reviews were queued
  if (reviewsQueued > 0) {
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
        transitions.push(`Dispatched code review processing (${reviewsQueued} queued)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        transitions.push(`Failed to dispatch code review processing: ${msg}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: now,
    transitions,
    reviewsQueued,
  });
}
