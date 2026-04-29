import type { Submission, CodeReview } from "../types";
import { getClient } from "./client";
import { toSubmission, toCodeReview } from "./mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";

// ─── Submission Queries ───────────────────────────────────

export async function getSubmissionsForChallenge(
  challengeId: string
): Promise<Submission[]> {
  const supabase = getClient();
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .limit(QUERY_LIMITS.submissionsPerChallenge);
  return (data ?? []).map(toSubmission);
}

export async function getSubmissionsForChallengeAuthenticated(
  challengeId: string
): Promise<Submission[]> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .limit(QUERY_LIMITS.submissionsPerChallenge);
  return (data ?? []).map(toSubmission);
}

export async function getSubmissionById(
  id: string
): Promise<Submission | null> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", id)
    .single();
  return data ? toSubmission(data) : null;
}

export async function getSubmissionForTeam(
  challengeId: string,
  teamId: string
): Promise<Submission | null> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .eq("team_id", teamId)
    .single();
  return data ? toSubmission(data) : null;
}

// ─── Code Review Queries ──────────────────────────────────

export async function getCodeReviewForSubmission(
  submissionId: string
): Promise<CodeReview | null> {
  const supabase = getClient();
  const { data } = await supabase
    .from("code_reviews")
    .select("*")
    .eq("submission_id", submissionId)
    .single();
  return data ? toCodeReview(data) : null;
}

export async function getCodeReviewForSubmissionAuthenticated(
  submissionId: string
): Promise<CodeReview | null> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("code_reviews")
    .select("*")
    .eq("submission_id", submissionId)
    .single();
  return data ? toCodeReview(data) : null;
}
