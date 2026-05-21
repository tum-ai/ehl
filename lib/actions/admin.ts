"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAction } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { renderCertificateEmail } from "@/lib/emails/render";
import { getPlacementLabel, formatDate } from "@/lib/utils";
import { logEvent, logEventStrict } from "@/lib/event-log";

// ─── Helpers ──────────────────────────────────────────────

async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Recalculates match_number for all chapters based on date order.
 * Chapters with dates are sorted chronologically, chapters without dates go last
 * (preserving their relative order by created_at).
 * Also updates the chapter name if it follows the "Match X" pattern.
 */
async function recalculateMatchNumbers(
  adminClient: ReturnType<typeof createAdminClient>
) {
  const { data: chapters } = await adminClient
    .from("chapters")
    .select("id, name, date, is_finale, created_at")
    .order("created_at");

  if (!chapters || chapters.length === 0) return;

  const withDate = chapters
    .filter((c) => c.date)
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const withoutDate = chapters.filter((c) => !c.date);

  const ordered = [...withDate, ...withoutDate];

  for (let i = 0; i < ordered.length; i++) {
    const newNumber = i + 1;
    const chapter = ordered[i];
    const update: Record<string, unknown> = { match_number: newNumber };

    // Auto-update name if it follows the "Match X" pattern (not for finale)
    if (!chapter.is_finale && /^Match \d+$/.test(chapter.name as string)) {
      update.name = `Match ${newNumber}`;
    }

    await adminClient
      .from("chapters")
      .update(update)
      .eq("id", chapter.id);
  }
}

// ─── Chapter Status ────────────────────────────────────────

export async function updateChapterStatus(chapterId: string, status: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Load chapter + related data for validation
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("*")
    .eq("id", chapterId)
    .single();

  if (!chapter) return { error: "Chapter not found." };

  // Run readiness checks for the target status
  const checks = await getStatusChecks(adminClient, chapter, status);
  const failures = checks.filter((c) => !c.passed);
  if (failures.length > 0) {
    return {
      error: `Cannot advance to "${status}". Missing:\n${failures.map((f) => `- ${f.label}`).join("\n")}`,
    };
  }

  const previousStatus = chapter.status;

  const { error } = await adminClient
    .from("chapters")
    .update({ status })
    .eq("id", chapterId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "chapter.status_changed",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { status: { from: previousStatus, to: status } },
  });

  revalidatePath("/admin/chapters");
  revalidatePath("/matches");
  return { success: true };
}

interface StatusCheck {
  label: string;
  passed: boolean;
}

async function getStatusChecks(
  adminClient: ReturnType<typeof createAdminClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chapter: any,
  targetStatus: string
): Promise<StatusCheck[]> {
  const checks: StatusCheck[] = [];

  // Going backwards is always allowed (no checks)
  const flow = [
    "draft", "announced", "applications_open", "preparation", "challenge_selection",
    "submissions_open", "pitching", "completed",
  ];
  const currentIdx = flow.indexOf(chapter.status);
  const targetIdx = flow.indexOf(targetStatus);
  if (targetIdx <= currentIdx) return [];

  // ─── Announced ────────────────────────────────────────
  if (targetIdx >= 1) {
    checks.push({
      label: "Name is set",
      passed: !!chapter.name?.trim(),
    });
    checks.push({
      label: "City is set",
      passed: !!chapter.city?.trim(),
    });
    checks.push({
      label: "Country is set",
      passed: !!chapter.country?.trim(),
    });
    checks.push({
      label: "Description is set",
      passed: !!chapter.description?.trim(),
    });
  }

  // ─── Applications Open ────────────────────────────────
  if (targetIdx >= 2) {
    checks.push({
      label: "Start date is set",
      passed: !!chapter.date,
    });
    checks.push({
      label: "Application deadline is set",
      passed: !!chapter.application_deadline,
    });
  }

  // ─── Screening/Preparation (idx 3) — no extra checks

  // ─── Challenge Selection / registration_open (idx 4) ──
  if (targetIdx >= 4) {
    checks.push({
      label: "Start date is set",
      passed: !!chapter.date,
    });
    checks.push({
      label: "End date is set",
      passed: !!chapter.date_end,
    });

    const { count: challengeCount } = await adminClient
      .from("challenges")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapter.id);

    checks.push({
      label: "At least one challenge exists",
      passed: (challengeCount ?? 0) > 0,
    });
    checks.push({
      label: "Challenge selection deadline is set",
      passed: !!chapter.challenge_selection_deadline,
    });
  }

  // ─── Submissions Open (idx 5) ──────────────────────────
  if (targetIdx >= 5) {
    const { count: registrationCount } = await adminClient
      .from("challenge_registrations")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapter.id);

    checks.push({
      label: "At least one team is registered",
      passed: (registrationCount ?? 0) > 0,
    });
    checks.push({
      label: "Submission deadline is set",
      passed: !!chapter.submission_deadline,
    });

    // Check code review config for challenges that have review enabled
    const { data: reviewChallenges } = await adminClient
      .from("challenges")
      .select("id, title, code_review_enabled, code_review_config")
      .eq("chapter_id", chapter.id)
      .eq("code_review_enabled", true);

    if (reviewChallenges && reviewChallenges.length > 0) {
      const unconfigured = reviewChallenges.filter(
        (c) => !c.code_review_config ||
          !(c.code_review_config as Record<string, unknown>).models ||
          !(c.code_review_config as Record<string, unknown>).weights
      );
      checks.push({
        label: unconfigured.length > 0
          ? `Code review not configured for: ${unconfigured.map((c) => c.title).join(", ")}`
          : "Code review is configured for all challenges with review enabled",
        passed: unconfigured.length === 0,
      });
    }
  }

  // ─── Pitching (idx 6) ─────────────────────────────────
  if (targetIdx >= 6) {
    const { data: challenges } = await adminClient
      .from("challenges")
      .select("id")
      .eq("chapter_id", chapter.id);

    if (challenges && challenges.length > 0) {
      const { count: submissionCount } = await adminClient
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .in("challenge_id", challenges.map((c) => c.id));

      checks.push({
        label: "At least one submission exists",
        passed: (submissionCount ?? 0) > 0,
      });
    }

    const { count: juryCount } = await adminClient
      .from("jury_assignments")
      .select("user_id", { count: "exact", head: true })
      .in(
        "challenge_id",
        (challenges ?? []).map((c) => c.id)
      );

    checks.push({
      label: "Jury is assigned to at least one challenge",
      passed: (juryCount ?? 0) > 0,
    });
  }

  // ─── Completed (idx 7) ─────────────────────────────────
  if (targetIdx >= 7) {
    const { count: scoreCount } = await adminClient
      .from("scores")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapter.id)
      .eq("published", true);

    checks.push({
      label: "Scores are published",
      passed: (scoreCount ?? 0) > 0,
    });
  }

  return checks;
}

/**
 * Get readiness checks for a chapter without changing status.
 * Used by the client to show what's missing.
 */
export async function getChapterReadiness(chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const { data: chapter } = await adminClient
    .from("chapters")
    .select("*")
    .eq("id", chapterId)
    .single();

  if (!chapter) return { checks: [] };

  const flow = [
    "draft", "announced", "applications_open", "preparation", "challenge_selection",
    "submissions_open", "pitching", "completed",
  ];
  const currentIdx = flow.indexOf(chapter.status as string);
  const nextStatus = currentIdx < flow.length - 1 ? flow[currentIdx + 1] : null;

  if (!nextStatus) return { checks: [], nextStatus: null };

  const checks = await getStatusChecks(adminClient, chapter, nextStatus);
  return { checks, nextStatus };
}

// ─── Chapter Details (unified save) ──────────────────────

export async function updateChapterDetails(
  chapterId: string,
  data: {
    name: string;
    city: string;
    country: string;
    description: string;
    date: string | null;
    dateEnd: string | null;
    heroImageUrl: string | null;
    photoAlbumUrl: string | null;
    challengeRegistrationEnabled: boolean;
    applicationDeadline?: string | null;
    challengeSelectionDeadline?: string | null;
    submissionDeadline?: string | null;
  }
) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("chapters")
    .update({
      name: data.name,
      city: data.city,
      country: data.country,
      description: data.description,
      date: data.date,
      date_end: data.dateEnd,
      hero_image_url: data.heroImageUrl,
      photo_album_url: data.photoAlbumUrl || null,
      challenge_registration_enabled: data.challengeRegistrationEnabled,
      application_deadline: data.applicationDeadline ?? null,
      challenge_selection_deadline: data.challengeSelectionDeadline ?? null,
      submission_deadline: data.submissionDeadline ?? null,
    })
    .eq("id", chapterId);

  if (error) return { error: error.message };

  // Recalculate match_number for all chapters based on date order
  await recalculateMatchNumbers(adminClient);

  const actorId = await getAdminUserId();
  logEvent({
    action: "chapter.updated",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { updated: { name: data.name, city: data.city, country: data.country } },
  });

  revalidatePath(`/admin/chapters/${chapterId}`);
  revalidatePath(`/admin/chapters`);
  revalidatePath(`/matches`);
  revalidatePath(`/`);
  return { success: true };
}

// ─── Team Unlocks ──────────────────────────────────────────

export async function unlockTeams(chapterId: string, teamIds: string[]) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminUserId = await getAdminUserId();

  const adminClient = createAdminClient();

  const inserts = teamIds.map((teamId) => ({
    chapter_id: chapterId,
    team_id: teamId,
    unlocked_by: adminUserId,
  }));

  const { error } = await adminClient
    .from("chapter_unlocks")
    .upsert(inserts, { onConflict: "chapter_id,team_id" });

  if (error) return { error: error.message };

  logEvent({
    action: "chapter.teams_unlocked",
    entityType: "chapter",
    entityId: chapterId,
    actorId: adminUserId,
    actorType: "admin",
    delta: { created: { team_ids: teamIds } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/unlocks`);
  return { success: true };
}

export async function revokeUnlock(chapterId: string, teamId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("chapter_unlocks")
    .delete()
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "chapter.unlock_revoked",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { deleted: { team_id: teamId } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/unlocks`);
  return { success: true };
}

// ─── Challenges ────────────────────────────────────────────

export async function createChallenge(formData: FormData) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const chapterId = formData.get("chapterId") as string;
  const title = formData.get("title") as string;
  const description = (formData.get("description") as string) || null;
  const sponsorName = (formData.get("sponsorName") as string) || null;
  const sponsorLogoUrl = (formData.get("sponsorLogoUrl") as string) || null;
  const prizeDescription = (formData.get("prizeDescription") as string) || null;
  const judgingCriteria = (formData.get("judgingCriteria") as string) || null;
  const codeReviewEnabled = formData.get("codeReviewEnabled") === "on";
  const isScored = formData.get("isScored") === "on";
  const inviteJuryToForks = formData.get("inviteJuryToForks") === "on";
  const submissionFieldsJson = formData.get("submissionFields") as string;
  const briefFileId = (formData.get("briefFileId") as string) || null;
  const codeReviewInstructions = (formData.get("codeReviewInstructions") as string) || null;
  const codeReviewConfigJson = formData.get("codeReviewConfig") as string;

  if (!chapterId || !title) {
    return { error: "Chapter ID and title are required." };
  }

  let submissionFields;
  try {
    submissionFields = submissionFieldsJson ? JSON.parse(submissionFieldsJson) : undefined;
  } catch {
    return { error: "Invalid submission fields JSON." };
  }

  let codeReviewConfig;
  try {
    codeReviewConfig = codeReviewConfigJson ? JSON.parse(codeReviewConfigJson) : undefined;
  } catch {
    // Ignore invalid config
  }

  const adminClient = createAdminClient();
  const { data: inserted, error } = await adminClient.from("challenges").insert({
    chapter_id: chapterId,
    title,
    description,
    sponsor_name: sponsorName,
    sponsor_logo_url: sponsorLogoUrl,
    prize_description: prizeDescription,
    judging_criteria: judgingCriteria,
    code_review_enabled: codeReviewEnabled,
    is_scored: isScored,
    invite_jury_to_forks: inviteJuryToForks,
    submission_fields: submissionFields,
    brief_file_id: briefFileId,
    code_review_instructions: codeReviewInstructions,
    code_review_config: codeReviewConfig,
  }).select("id").single();

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "challenge.created",
    entityType: "challenge",
    entityId: inserted?.id ?? chapterId,
    actorId,
    actorType: "admin",
    delta: { created: { title } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/challenges`);
  return { success: true };
}

export async function updateChallenge(formData: FormData) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const challengeId = formData.get("challengeId") as string;
  const chapterId = formData.get("chapterId") as string;
  const title = formData.get("title") as string;
  const description = (formData.get("description") as string) || null;
  const sponsorName = (formData.get("sponsorName") as string) || null;
  const sponsorLogoUrl = (formData.get("sponsorLogoUrl") as string) || null;
  const prizeDescription = (formData.get("prizeDescription") as string) || null;
  const judgingCriteria = (formData.get("judgingCriteria") as string) || null;
  const codeReviewEnabled = formData.get("codeReviewEnabled") === "on";
  const isScored = formData.get("isScored") === "on";
  const inviteJuryToForks = formData.get("inviteJuryToForks") === "on";
  const submissionFieldsJson = formData.get("submissionFields") as string;
  const briefFileId = (formData.get("briefFileId") as string) || null;
  const codeReviewInstructions = (formData.get("codeReviewInstructions") as string) || null;
  const codeReviewConfigJson = formData.get("codeReviewConfig") as string;

  if (!challengeId || !title) {
    return { error: "Challenge ID and title are required." };
  }

  let submissionFields;
  try {
    submissionFields = submissionFieldsJson ? JSON.parse(submissionFieldsJson) : undefined;
  } catch {
    return { error: "Invalid submission fields JSON." };
  }

  let codeReviewConfig;
  try {
    codeReviewConfig = codeReviewConfigJson ? JSON.parse(codeReviewConfigJson) : undefined;
  } catch {
    // Ignore invalid config
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("challenges")
    .update({
      title,
      description,
      sponsor_name: sponsorName,
      sponsor_logo_url: sponsorLogoUrl,
      prize_description: prizeDescription,
      judging_criteria: judgingCriteria,
      code_review_enabled: codeReviewEnabled,
      is_scored: isScored,
      invite_jury_to_forks: inviteJuryToForks,
      submission_fields: submissionFields,
      brief_file_id: briefFileId,
      code_review_instructions: codeReviewInstructions,
      code_review_config: codeReviewConfig,
    })
    .eq("id", challengeId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "challenge.updated",
    entityType: "challenge",
    entityId: challengeId,
    actorId,
    actorType: "admin",
    delta: { updated: { title } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/challenges`);
  return { success: true };
}

export async function deleteChallenge(challengeId: string, chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Fetch title before deleting for audit
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("title")
    .eq("id", challengeId)
    .single();

  const { error } = await adminClient
    .from("challenges")
    .delete()
    .eq("id", challengeId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "challenge.deleted",
    entityType: "challenge",
    entityId: challengeId,
    actorId,
    actorType: "admin",
    delta: { deleted: { title: challenge?.title ?? null } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/challenges`);
  return { success: true };
}

// ─── Pitch Order ───────────────────────────────────────────

export async function generatePitchOrder(challengeId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminUserId = await getAdminUserId();

  const adminClient = createAdminClient();

  // Get all registrations for this challenge
  const { data: registrations } = await adminClient
    .from("challenge_registrations")
    .select("team_id")
    .eq("challenge_id", challengeId);

  if (!registrations || registrations.length === 0) {
    return { error: "No teams registered for this challenge." };
  }

  // Shuffle using Fisher-Yates with cryptographic randomness
  const teamIds = registrations.map((r) => r.team_id as string);
  for (let i = teamIds.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [teamIds[i], teamIds[j]] = [teamIds[j], teamIds[i]];
  }

  const { error } = await adminClient
    .from("pitch_orders")
    .upsert({
      challenge_id: challengeId,
      order_list: teamIds,
      generated_by: adminUserId,
      generated_at: new Date().toISOString(),
    });

  if (error) return { error: error.message };

  logEvent({
    action: "challenge.pitch_order_generated",
    entityType: "challenge",
    entityId: challengeId,
    actorId: adminUserId,
    actorType: "admin",
    delta: { created: { count: teamIds.length } },
  });

  return { success: true, order: teamIds };
}

// ─── Team Deletion ────────────────────────────────────────

export async function deleteTeam(teamId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Fetch team name before deleting for audit
  const { data: team } = await adminClient
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .single();

  // Delete team members first (FK constraint)
  await adminClient.from("team_members").delete().eq("team_id", teamId);

  // Delete the team
  const { error } = await adminClient.from("teams").delete().eq("id", teamId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "team.deleted",
    entityType: "team",
    entityId: teamId,
    actorId,
    actorType: "admin",
    delta: { deleted: { name: team?.name ?? null } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

// ─── Delete Participant ──────────────────────────────────────

export async function deleteParticipant(userId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Fetch profile for audit trail
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email, name")
    .eq("id", userId)
    .single();

  if (!profile) return { error: "Participant not found." };

  // Block deletion of admin accounts
  const { data: adminCheck } = await adminClient
    .from("admin_emails")
    .select("email")
    .eq("email", profile.email as string)
    .single();
  if (adminCheck) return { error: "Cannot delete admin accounts." };

  // FK-safe deletion order
  await adminClient.from("screening_scores").delete().eq("application_id", userId);
  await adminClient.from("team_invites").delete().eq("invited_email", profile.email as string);
  await adminClient.from("team_join_requests").delete().eq("user_id", userId);
  await adminClient.from("verification_codes").delete().eq("email", profile.email as string);
  await adminClient.from("participant_flags").delete().eq("profile_id", userId);
  await adminClient.from("applications").delete().eq("email", profile.email as string);

  // Remove from team (update president if needed)
  const { data: membership } = await adminClient
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId);

  for (const m of membership ?? []) {
    if (m.role === "president") {
      await adminClient.from("teams").update({ president_user_id: null }).eq("id", m.team_id as string);
    }
  }
  await adminClient.from("team_members").delete().eq("user_id", userId);

  // Delete profile and auth user
  await adminClient.from("profiles").delete().eq("id", userId);
  await adminClient.auth.admin.deleteUser(userId);

  const actorId = await getAdminUserId();
  logEvent({
    action: "participant.deleted",
    entityType: "profile",
    entityId: userId,
    actorId,
    actorType: "admin",
    delta: { deleted: { email: profile.email, name: profile.name } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

// ─── Score Publishing ──────────────────────────────────────

export async function publishScores(chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Mark all scores for this chapter as published
  const { error: scoreError } = await adminClient
    .from("scores")
    .update({ published: true, published_at: new Date().toISOString() })
    .eq("chapter_id", chapterId);

  if (scoreError) return { error: scoreError.message };

  // Set chapter status to completed
  const { error: chapterError } = await adminClient
    .from("chapters")
    .update({ status: "completed" })
    .eq("id", chapterId);

  if (chapterError) return { error: chapterError.message };

  const actorId = await getAdminUserId();
  await logEventStrict({
    action: "score.published",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { status: { from: "unpublished", to: "published" } },
  });

  revalidatePath("/admin/chapters");
  revalidatePath("/matches");
  revalidatePath("/leaderboard");
  return { success: true };
}

// ─── Chapter Photos ───────────────────────────────────────

export async function addChapterPhoto(chapterId: string, fileId: string, caption?: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const { data: inserted, error } = await adminClient.from("media").insert({
    chapter_id: chapterId,
    type: "photo",
    url: fileId,
    thumbnail_url: null,
    caption: caption || null,
    featured: false,
  }).select("id").single();

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "media.created",
    entityType: "media",
    entityId: inserted?.id ?? chapterId,
    actorId,
    actorType: "admin",
    delta: { created: { chapter_id: chapterId } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/photos`);
  revalidatePath(`/matches`);
  return { success: true };
}

export async function deleteChapterPhoto(photoId: string, chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const { error } = await adminClient.from("media").delete().eq("id", photoId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "media.deleted",
    entityType: "media",
    entityId: photoId,
    actorId,
    actorType: "admin",
    delta: { deleted: { chapter_id: chapterId } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/photos`);
  revalidatePath(`/matches`);
  return { success: true };
}

export async function togglePhotoFeatured(photoId: string, featured: boolean, chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("media")
    .update({ featured })
    .eq("id", photoId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "media.featured_toggled",
    entityType: "media",
    entityId: photoId,
    actorId,
    actorType: "admin",
    delta: { status: { from: !featured, to: featured } },
  });

  revalidatePath(`/admin/chapters/${chapterId}/photos`);
  revalidatePath(`/matches`);
  return { success: true };
}

// ─── Admin: Remove member from team ───────────────────────

export async function adminRemoveMember(teamId: string, userId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const adminClient = createAdminClient();

  // Cannot remove the president
  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", teamId)
    .single();

  if (!team) return { error: "Team not found." };
  if (team.president_user_id === userId) {
    return { error: "Cannot remove the team president." };
  }

  const { error: delError } = await adminClient
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (delError) return { error: delError.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "team.member_removed",
    entityType: "team",
    entityId: teamId,
    actorId,
    actorType: "admin",
    delta: { deleted: { user_id: userId } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

// ─── Certificate Emails ──────────────────────────────────

export async function sendCertificateEmails(chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const adminClient = createAdminClient();

  // Verify chapter exists and scores are published
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("name, city, country, date, date_end, status")
    .eq("id", chapterId)
    .single();

  if (!chapter) return { error: "Chapter not found." };
  if (chapter.status !== "completed") {
    return { error: "Scores must be published before sending certificates." };
  }

  // Get all published scores for this chapter
  const { data: scores } = await adminClient
    .from("scores")
    .select("team_id, placement, points, challenge_name, published")
    .eq("chapter_id", chapterId)
    .eq("published", true);

  if (!scores || scores.length === 0) {
    return { error: "No published scores found for this chapter." };
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  // Format date
  const chapterDate = chapter.date
    ? chapter.date_end
      ? `${formatDate(chapter.date as string)} - ${formatDate(chapter.date_end as string)}`
      : formatDate(chapter.date as string)
    : "";

  const chapterCity = `${chapter.city as string}, ${chapter.country as string}`;

  let sent = 0;
  let failed = 0;

  for (const score of scores) {
    const teamId = score.team_id as string;

    // Get team members with their email addresses
    const { data: members } = await adminClient
      .from("team_members")
      .select("profiles(email, name)")
      .eq("team_id", teamId);

    // Get team name
    const { data: team } = await adminClient
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .single();

    if (!team || !members) continue;

    const placement = score.placement as number | null;
    const placementLabel = placement
      ? `${getPlacementLabel(placement)} Place`
      : "Participant";

    const certificateUrl = `${baseUrl}/api/certificates/${chapterId}/${teamId}`;

    const emails = members
      .map((m) => {
        const profile = m.profiles as unknown as { email: string | null; name: string | null } | null;
        return profile?.email;
      })
      .filter((e): e is string => !!e);

    if (emails.length === 0) continue;

    try {
      const html = await renderCertificateEmail({
        teamName: team.name as string,
        chapterName: chapter.name as string,
        chapterCity,
        chapterDate,
        placementLabel,
        points: score.points as number,
        certificateUrl,
      });

      // Fire-and-forget per team (don't block the loop)
      await sendEmail({
        to: emails,
        subject: `Your EHL Certificate: ${chapter.name as string}`,
        html,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send certificate email to team ${teamId}:`, err);
      failed++;
    }
  }

  const actorId = await getAdminUserId();
  logEvent({
    action: "chapter.certificates_sent",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { created: { sent, failed } },
  });

  return { success: true, sent, failed };
}
