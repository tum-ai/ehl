"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/event-log";

export async function submitScore(
  applicationId: string,
  score: number,
  notes: string
) {
  if (score < 1 || score > 10) {
    return { error: "Score must be between 1 and 10." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  const adminClient = createAdminClient();

  // Verify admin role
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { error: "Unauthorized." };
  }

  // Upsert score (allows updating own score)
  const { error } = await adminClient.from("screening_scores").upsert(
    {
      application_id: applicationId,
      screener_id: user.id,
      score,
      notes: notes || null,
    },
    { onConflict: "application_id,screener_id" }
  );

  if (error) {
    return { error: error.message };
  }

  logEvent({
    action: "screening.score_submitted",
    entityType: "screening_score",
    entityId: applicationId,
    actorType: "admin",
    delta: { created: { score } },
  });

  // Return updated scores for this application with screener names
  const { data: scores } = await adminClient
    .from("screening_scores")
    .select("screener_id, score, notes, created_at, profiles!inner(name, email)")
    .eq("application_id", applicationId)
    .order("created_at");

  const enrichedScores = (scores ?? []).map((s) => {
    const p = s.profiles as unknown as { name: string | null; email: string | null };
    return {
      screener_id: s.screener_id,
      screener_name: p?.name || p?.email || "Unknown",
      score: s.score,
      notes: s.notes,
      created_at: s.created_at,
    };
  });

  return { success: true, scores: enrichedScores, screenerId: user.id };
}

export async function getMyScreenerId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
