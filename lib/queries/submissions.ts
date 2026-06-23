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

/**
 * All submissions across every chapter/challenge, for the global admin
 * submissions view. Uses the authenticated server client so RLS applies (global
 * admins see all; the page guard restricts who can call this). Returns the
 * limit so the caller can show a LimitBanner when truncated.
 */
export async function getAllSubmissions(): Promise<{
  submissions: Submission[];
  limit: number;
  limited: boolean;
}> {
  const { createClient: createServerClient } = await import("@/lib/supabase/server");
  const supabase = await createServerClient();
  const limit = QUERY_LIMITS.submissionsAll;
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  const submissions = (data ?? []).map(toSubmission);
  return { submissions, limit, limited: submissions.length >= limit };
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
