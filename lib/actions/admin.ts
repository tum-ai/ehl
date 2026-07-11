"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureFileLinkReadable, getFileMimeType } from "@/lib/gdrive";
import { requireAdminAction, requireChapterAdminAction, getActingUserId } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";
import { renderCertificateEmail } from "@/lib/emails/render";
import { getPlacementLabel, formatDate, runWithConcurrency } from "@/lib/utils";
import { isPlacedPlacement } from "@/lib/scoring";
import { certificateToken, certificateTokenV2 } from "@/lib/certificate-token";
import { logEvent, logEventStrict } from "@/lib/event-log";
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE } from "@/lib/config/limits";
import type { ChapterStatus } from "@/lib/types";
import {
  isBackwardTransition,
  getTargetIndex,
  getNextStatus,
  getStatusChecksForTarget,
  type StatusCheck,
  type StatusCheckCounts,
} from "@/lib/chapter-validation";

// ─── Helpers ──────────────────────────────────────────────

// Audit-event actor resolution is centralized in lib/admin-auth.ts as
// getActingUserId(). Local alias keeps the existing call sites readable.
const getAdminUserId = getActingUserId;

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

async function getStatusChecks(
  adminClient: ReturnType<typeof createAdminClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chapter: any,
  targetStatus: string
): Promise<StatusCheck[]> {
  const currentStatus = chapter.status as ChapterStatus;
  const target = targetStatus as ChapterStatus;

  // Backward transitions need no checks.
  if (isBackwardTransition(currentStatus, target)) return [];

  const targetIdx = getTargetIndex(target);
  const idxOf = (s: ChapterStatus) => getTargetIndex(s);

  // Gather only the DB-derived counts the target actually needs, then hand the
  // flow/field logic to the pure (tested) getStatusChecksForTarget.
  const counts: StatusCheckCounts = {};

  if (targetIdx >= idxOf("challenge_selection")) {
    const { count } = await adminClient
      .from("challenges")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapter.id);
    counts.challengeCount = count ?? 0;
  }

  if (targetIdx >= idxOf("hacking")) {
    const { count } = await adminClient
      .from("challenge_registrations")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapter.id);
    counts.registrationCount = count ?? 0;

    const { data: reviewChallenges } = await adminClient
      .from("challenges")
      .select("id, title, code_review_enabled, code_review_config")
      .eq("chapter_id", chapter.id)
      .eq("code_review_enabled", true);

    counts.unconfiguredReviewChallenges = (reviewChallenges ?? [])
      .filter(
        (c) =>
          !c.code_review_config ||
          !(c.code_review_config as Record<string, unknown>).models ||
          !(c.code_review_config as Record<string, unknown>).weights
      )
      .map((c) => c.title as string);
  }

  if (targetIdx >= idxOf("pitching")) {
    const { data: challenges } = await adminClient
      .from("challenges")
      .select("id")
      .eq("chapter_id", chapter.id);
    const challengeIds = (challenges ?? []).map((c) => c.id);

    if (challengeIds.length > 0) {
      const { count: submissionCount } = await adminClient
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .in("challenge_id", challengeIds);
      counts.submissionCount = submissionCount ?? 0;
    } else {
      counts.submissionCount = 0;
    }

    const { count: juryCount } = await adminClient
      .from("jury_assignments")
      .select("user_id", { count: "exact", head: true })
      .in("challenge_id", challengeIds);
    counts.juryCount = juryCount ?? 0;
  }

  if (targetIdx >= idxOf("completed")) {
    const { count } = await adminClient
      .from("scores")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapter.id)
      .eq("published", true);
    counts.publishedScoreCount = count ?? 0;
  }

  return getStatusChecksForTarget(currentStatus, target, chapter, counts);
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

  const nextStatus = getNextStatus(chapter.status as ChapterStatus);

  if (!nextStatus) return { checks: [], nextStatus: null };

  const checks = await getStatusChecks(adminClient, chapter, nextStatus);
  return { checks, nextStatus };
}

// ─── Create Chapter ───────────────────────────────────────

export async function createNewChapter(): Promise<{ error?: string; id?: string }> {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const slug = `new-chapter-${Date.now()}`;

  // chapters.match_number is NOT NULL with no default, so the insert must supply
  // a value. recalculateMatchNumbers() reassigns the correct ordering right
  // after, so any unused number works here; use max+1 to avoid colliding with an
  // existing row's number before the recalc runs.
  const { data: maxRow } = await adminClient
    .from("chapters")
    .select("match_number")
    .order("match_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextMatchNumber = ((maxRow?.match_number as number | null) ?? 0) + 1;

  const { data, error } = await adminClient
    .from("chapters")
    .insert({
      name: "New Chapter",
      slug,
      match_number: nextMatchNumber,
      city: "",
      country: "",
      country_code: "",
      description: "",
      status: "draft",
      is_finale: false,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await recalculateMatchNumbers(adminClient);

  const actorId = await getAdminUserId();
  logEvent({
    action: "chapter.created",
    entityType: "chapter",
    entityId: data.id,
    actorId,
    actorType: "admin",
    delta: { slug },
  });

  revalidatePath("/admin/chapters");
  revalidatePath("/matches");
  return { id: data.id };
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
  // Accept both "true" (new explicit form) and "on" (legacy raw checkbox).
  const checked = (name: string) => {
    const v = formData.get(name);
    return v === "true" || v === "on";
  };
  const codeReviewEnabled = checked("codeReviewEnabled");
  const isScored = checked("isScored");
  const inviteJuryToForks = checked("inviteJuryToForks");
  const entireRequired = checked("entireRequired");
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
    entire_required: entireRequired,
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

// Maps a managedFields token -> the challenges column it writes. Only fields the
// caller EXPLICITLY declares it manages are written; every other column is left
// untouched. This closes a destructive class of bug: a partial form (e.g. the
// code-review config panel) that omitted a checkbox used to silently clear it,
// because an unchecked HTML checkbox and a "field this form does not own" are
// indistinguishable by absence. A challenge created as Scored would silently
// flip to unscored after saving an unrelated panel. Never again: absence now
// means "do not touch", and only declared fields are written.
const CHALLENGE_FIELD_COLUMNS = {
  title: "title",
  description: "description",
  sponsorName: "sponsor_name",
  sponsorLogoUrl: "sponsor_logo_url",
  prizeDescription: "prize_description",
  judgingCriteria: "judging_criteria",
  codeReviewEnabled: "code_review_enabled",
  isScored: "is_scored",
  inviteJuryToForks: "invite_jury_to_forks",
  entireRequired: "entire_required",
  submissionFields: "submission_fields",
  briefFileId: "brief_file_id",
  codeReviewInstructions: "code_review_instructions",
  codeReviewConfig: "code_review_config",
} as const;

type ChallengeFieldKey = keyof typeof CHALLENGE_FIELD_COLUMNS;

// Form fields that carry a boolean, sent explicitly as "true"/"false" (never as
// a bare checkbox whose absence is ambiguous). When the field is managed, a
// value other than "true" is written as false intentionally.
const CHALLENGE_BOOLEAN_FIELDS = new Set<ChallengeFieldKey>([
  "codeReviewEnabled",
  "isScored",
  "inviteJuryToForks",
  "entireRequired",
]);

export async function updateChallenge(formData: FormData) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const challengeId = formData.get("challengeId") as string;
  const chapterId = (formData.get("chapterId") as string) || "";

  if (!challengeId) {
    return { error: "Challenge ID is required." };
  }

  // The form declares which fields it owns. Legacy callers that omit the
  // manifest fall back to "every field present in the payload is owned" so a
  // checkbox sent as "true"/"false" still works, but a field entirely absent is
  // never cleared.
  const managedRaw = formData.get("managedFields");
  const declared = typeof managedRaw === "string" && managedRaw.length > 0;
  const managed = new Set(
    declared
      ? (managedRaw as string).split(",").map((s) => s.trim()).filter(Boolean)
      : []
  );

  function owns(field: ChallengeFieldKey): boolean {
    if (declared) return managed.has(field);
    // No manifest: treat a field as owned only if it is actually present.
    return formData.has(field);
  }

  const patch: Record<string, unknown> = {};

  for (const key of Object.keys(CHALLENGE_FIELD_COLUMNS) as ChallengeFieldKey[]) {
    if (!owns(key)) continue;
    const column = CHALLENGE_FIELD_COLUMNS[key];
    const raw = formData.get(key);

    if (CHALLENGE_BOOLEAN_FIELDS.has(key)) {
      // Explicit boolean: "true" => true, anything else (incl. "off"/"false") => false.
      patch[column] = raw === "true" || raw === "on";
      continue;
    }

    if (key === "title") {
      const title = (raw as string) ?? "";
      if (!title.trim()) return { error: "Title is required." };
      patch[column] = title;
      continue;
    }

    if (key === "submissionFields") {
      const json = (raw as string) ?? "";
      if (!json) {
        patch[column] = null;
      } else {
        try {
          patch[column] = JSON.parse(json);
        } catch {
          return { error: "Invalid submission fields JSON." };
        }
      }
      continue;
    }

    if (key === "codeReviewConfig") {
      const json = (raw as string) ?? "";
      if (!json) {
        patch[column] = null;
      } else {
        try {
          patch[column] = JSON.parse(json);
        } catch {
          return { error: "Invalid code review config JSON." };
        }
      }
      continue;
    }

    // Nullable text columns: empty string => null.
    const text = (raw as string) ?? "";
    patch[column] = text.length > 0 ? text : null;
  }

  if (Object.keys(patch).length === 0) {
    return { error: "No fields to update." };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("challenges")
    .update(patch)
    .eq("id", challengeId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "challenge.updated",
    entityType: "challenge",
    entityId: challengeId,
    actorId,
    actorType: "admin",
    delta: { updated: { fields: [...Object.keys(patch)] } },
  });

  if (chapterId) revalidatePath(`/admin/chapters/${chapterId}/challenges`);
  return { success: true };
}

// Dedicated, narrow action for the code-review "Configure" panel. It writes ONLY
// the code-review fields and NEVER touches is_scored / entire_required / etc.
// Previously this panel called the full updateChallenge with a partial payload,
// silently clearing every challenge flag it omitted (the Scored->unscored bug).
export async function updateCodeReviewConfig(
  challengeId: string,
  config: unknown,
  opts?: { enabled?: boolean }
) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  if (!challengeId) return { error: "Challenge ID is required." };

  const adminClient = createAdminClient();

  // Resolve chapter for revalidation (and to confirm the challenge exists).
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("chapter_id")
    .eq("id", challengeId)
    .single();
  if (!challenge) return { error: "Challenge not found." };

  const patch: Record<string, unknown> = { code_review_config: config };
  if (typeof opts?.enabled === "boolean") {
    patch.code_review_enabled = opts.enabled;
  }

  const { error } = await adminClient
    .from("challenges")
    .update(patch)
    .eq("id", challengeId);

  if (error) return { error: error.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "challenge.updated",
    entityType: "challenge",
    entityId: challengeId,
    actorId,
    actorType: "admin",
    delta: { updated: { fields: [...Object.keys(patch)] } },
  });

  revalidatePath(`/admin/chapters/${challenge.chapter_id as string}/challenges`);
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

/**
 * Delete a chapter (match) and everything under it. GLOBAL admins only
 * (requireAdminAction rejects chapter_admins, per CLAUDE.md: local admins may
 * never delete).
 *
 * Most children cascade on delete (challenges then submissions, jury rankings,
 * jury feedback, code reviews; applications then notes and screening_scores;
 * scores, jury_assignments, challenge_registrations, chapter_admins). But three
 * FKs are NO ACTION (media, partners, team_join_requests) and would block the
 * delete with a constraint violation. The delete_chapter_cascade RPC (migration
 * 00050) removes those three children and the chapter in a SINGLE transaction,
 * so the operation is atomic: it never leaves a chapter partially stripped.
 */
export async function deleteChapter(chapterId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // Fetch name before deleting for the audit log.
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("name")
    .eq("id", chapterId)
    .single();

  if (!chapter) return { error: "Chapter not found." };

  // Atomic delete: a single Postgres function removes the NO-ACTION children
  // (media, partners, team_join_requests) and the chapter in one transaction, so
  // a failure can never leave the chapter partially stripped (see migration
  // 00050_delete_chapter_cascade). The remaining children cascade.
  const { error } = await adminClient.rpc("delete_chapter_cascade", {
    target_chapter_id: chapterId,
  });
  if (error) return { error: `Failed to delete chapter: ${error.message}` };

  const actorId = await getAdminUserId();
  logEvent({
    action: "chapter.deleted",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { deleted: { name: chapter.name ?? null } },
  });

  // Revalidate the admin list AND the public surfaces that show matches.
  revalidatePath("/admin/chapters");
  revalidatePath("/matches");
  revalidatePath("/");
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

  // FK-safe deletion order. Every delete is now error-checked: the original code
  // swallowed all errors and returned success even when profiles.delete() failed
  // on the event_log.actor_id FK, so a "deleted" user reappeared in search.
  // Admins see the real error (no security risk: this path is admin-only).
  const del = async (table: string, col: string, val: string) => {
    const { error } = await adminClient.from(table).delete().eq(col, val);
    return error;
  };

  let e: { message: string } | null = null;
  e = await del("team_invites", "email", profile.email as string);
  if (e) return { error: `Failed to delete team invites: ${e.message}` };
  e = await del("team_join_requests", "user_id", userId);
  if (e) return { error: `Failed to delete join requests: ${e.message}` };
  e = await del("verification_codes", "email", profile.email as string);
  if (e) return { error: `Failed to delete verification codes: ${e.message}` };
  // participant_flags has NO profile_id column: it matches the flagged person by
  // normalized email (lowercased+trimmed, exactly as flag creation stores it).
  // The old `.eq("profile_id", userId)` referenced a nonexistent column and, once
  // error-checked, would break deletion entirely. (created_by/resolved_by are
  // admin actor columns and are not the participant being deleted.)
  e = await del(
    "participant_flags",
    "email",
    (profile.email as string).toLowerCase().trim()
  );
  if (e) return { error: `Failed to delete participant flags: ${e.message}` };
  e = await del("applications", "email", profile.email as string);
  if (e) return { error: `Failed to delete applications: ${e.message}` };

  // Remove from team (update president if needed)
  const { data: membership } = await adminClient
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", userId);

  for (const m of membership ?? []) {
    if (m.role === "president") {
      const { error: presErr } = await adminClient
        .from("teams")
        .update({ president_user_id: null })
        .eq("id", m.team_id as string);
      if (presErr)
        return { error: `Failed to clear team president: ${presErr.message}` };
    }
  }
  e = await del("team_members", "user_id", userId);
  if (e) return { error: `Failed to remove team memberships: ${e.message}` };

  // Delete the auth user FIRST: profiles.id references auth.users(id) ON DELETE
  // CASCADE, so removing the auth user cascades the profile away. This avoids the
  // worst partial state (profile gone, auth user orphaned). The event_log
  // actor_id FK is now ON DELETE SET NULL (migration 00058), so the historical
  // audit rows survive with actor_id nulled instead of blocking the delete.
  const { error: authErr } = await adminClient.auth.admin.deleteUser(userId);
  if (authErr) {
    return { error: `Failed to delete auth user: ${authErr.message}` };
  }

  // Belt and suspenders: ensure the profile row is gone (cascade should have
  // handled it; surface any residual error rather than silently leaving it).
  const { error: profileErr } = await adminClient
    .from("profiles")
    .delete()
    .eq("id", userId);
  if (profileErr) {
    return { error: `Auth user deleted but profile remained: ${profileErr.message}` };
  }

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

  // Resolve the acting admin BEFORE publishing, so logEventStrict can never throw
  // a "no actor" error after the scores/chapter have already been mutated.
  const actorId = await getAdminUserId();
  if (!actorId) return { error: "Could not identify admin user." };

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

  // Photos are displayed via lh3.googleusercontent.com thumbnails, which only
  // work for link-readable Drive files - uploadFile() creates PRIVATE files
  // (correct for CVs, wrong for gallery photos). Without this grant the photo
  // row is created but every thumbnail renders broken (Drive serves a sign-in
  // page instead of the image). Fail loudly, not with a broken gallery.
  //
  // PROVENANCE GUARD before making anything public: the fileId is
  // caller-supplied, and this action must never be usable to publicize a
  // non-photo file (e.g. a CV's Drive id). Two independent checks:
  // 1. the Drive file must be an image;
  // 2. the fileId must not be referenced as any application's CV.
  const mimeType = await getFileMimeType(fileId);
  if (!mimeType || !mimeType.startsWith("image/")) {
    return { error: "Only image files can be added as photos." };
  }
  const provenanceClient = createAdminClient();
  const { data: cvOwner, error: cvCheckError } = await provenanceClient
    .from("applications")
    .select("id")
    .eq("cv_url", fileId)
    .limit(1)
    .maybeSingle();
  if (cvCheckError) return { error: cvCheckError.message };
  if (cvOwner) {
    return { error: "This file is a CV and cannot be published as a photo." };
  }

  const readable = await ensureFileLinkReadable(fileId);
  if (!readable) {
    return {
      error:
        "Photo uploaded to Drive but could not be made publicly viewable. It would render as a broken image, so it was not added. Try again.",
    };
  }

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

  // The member must actually be on this team, and the removal must leave the
  // team with at least MIN_TEAM_SIZE members.
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", teamId);
  const roster = members ?? [];
  const memberRow = roster.find((m) => m.user_id === userId);
  if (!memberRow) {
    return { error: "That user is not a member of this team." };
  }
  if (roster.length - 1 < MIN_TEAM_SIZE) {
    return {
      error: `Removing this member would leave fewer than ${MIN_TEAM_SIZE} members on the team.`,
    };
  }

  const { error: delError } = await adminClient
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (delError) return { error: delError.message };

  // Guard against a check-then-act race: two admins removing different members
  // of the same team concurrently could each pass the size check above and
  // together drop the team below MIN_TEAM_SIZE. Re-count AFTER the delete; if we
  // crossed the floor, compensate by re-inserting the row we just removed and
  // report the failure. (This action is admin-only and rare, so an optimistic
  // delete + compensation is simpler and safe vs. a dedicated transactional RPC.)
  const { count: remaining } = await adminClient
    .from("team_members")
    .select("user_id", { count: "exact", head: true })
    .eq("team_id", teamId);
  if (remaining !== null && remaining < MIN_TEAM_SIZE) {
    await adminClient.from("team_members").insert({
      team_id: teamId,
      user_id: userId,
      role: (memberRow as { role?: string }).role ?? "member",
    });
    return {
      error: `Removing this member would leave fewer than ${MIN_TEAM_SIZE} members on the team.`,
    };
  }

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

// ─── Admin team/member overrides (audit-logged) ──────────
//
// These let an admin resolve exception cases through the UI (e.g. a typo'd
// account set as captain, a member on the wrong team). All require
// requireAdminAction(), use the admin client, and write an audit log entry.
// The only hard invariant enforced is team size (MAX_TEAM_SIZE) and "every team
// keeps exactly one president".

/**
 * Promote a team member to president (captain), demoting the current president.
 * Keeps teams.president_user_id and team_members.role in sync (both are sources
 * of truth: RLS reads president_user_id, the UI reads role).
 */
export async function adminChangeCaptain(teamId: string, newCaptainUserId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  const { data: team } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", teamId)
    .single();
  if (!team) return { error: "Team not found." };

  // The new captain must already be a member of this team.
  const { data: membership } = await adminClient
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", teamId)
    .eq("user_id", newCaptainUserId)
    .maybeSingle();
  if (!membership) return { error: "That user is not a member of this team." };

  const oldCaptainId = team.president_user_id as string | null;
  if (oldCaptainId === newCaptainUserId) {
    return { error: "That member is already the captain." };
  }

  // Demote the old president to member (if any).
  const actorId = await getAdminUserId();

  // On a partial failure, log the inconsistency so it can be reconciled.
  const logDiverged = (step: string, msg: string) =>
    logEvent({
      action: "team.captain_change_diverged",
      entityType: "team",
      entityId: teamId,
      actorId,
      actorType: "admin",
      delta: { failed_step: step, error: msg, from: oldCaptainId, to: newCaptainUserId },
    });

  // Update teams.president_user_id FIRST: it's the field RLS reads, so even if a
  // later team_members sync fails, president powers already point at the new
  // captain (no stale privilege on the old one).
  const { error: teamErr } = await adminClient
    .from("teams")
    .update({ president_user_id: newCaptainUserId })
    .eq("id", teamId);
  if (teamErr) return { error: teamErr.message };

  // Promote the new captain's role.
  const { error: promoteErr } = await adminClient
    .from("team_members")
    .update({ role: "president" })
    .eq("team_id", teamId)
    .eq("user_id", newCaptainUserId);
  if (promoteErr) {
    logDiverged("promote", promoteErr.message);
    return { error: `Captain set, but role update failed (logged): ${promoteErr.message}` };
  }

  // Demote the old captain's role.
  if (oldCaptainId) {
    const { error: demoteErr } = await adminClient
      .from("team_members")
      .update({ role: "member" })
      .eq("team_id", teamId)
      .eq("user_id", oldCaptainId);
    if (demoteErr) {
      logDiverged("demote", demoteErr.message);
      return { error: `Captain set, but old captain's role update failed (logged): ${demoteErr.message}` };
    }
  }

  logEvent({
    action: "team.captain_changed",
    entityType: "team",
    entityId: teamId,
    actorId,
    actorType: "admin",
    delta: { from: { president_user_id: oldCaptainId }, to: { president_user_id: newCaptainUserId } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

/**
 * Add an existing user (by email) to a team as a member. Enforces the team-size
 * invariant (MAX_TEAM_SIZE).
 */
export async function adminAddMemberByEmail(teamId: string, email: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { error: "Email is required." };
  const adminClient = createAdminClient();

  const { data: team } = await adminClient.from("teams").select("id").eq("id", teamId).single();
  if (!team) return { error: "Team not found." };

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, email")
    .eq("email", normalized)
    .maybeSingle();
  if (!profile) return { error: `No user found with email ${normalized}.` };

  // Already on this team?
  const { data: existing } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (existing) return { error: "That user is already on this team." };

  // Size guardrail.
  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  if ((members?.length ?? 0) >= MAX_TEAM_SIZE) {
    return { error: `Team is full (${MAX_TEAM_SIZE} members max).` };
  }

  const { error: insertErr } = await adminClient
    .from("team_members")
    .insert({ team_id: teamId, user_id: profile.id, role: "member" });
  if (insertErr) return { error: insertErr.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "team.member_added",
    entityType: "team",
    entityId: teamId,
    actorId,
    actorType: "admin",
    delta: { created: { user_id: profile.id, email: normalized } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

/**
 * Move a member from one team to another. Enforces the destination team size,
 * keeps the source team at or above MIN_TEAM_SIZE (a move empties a seat on the
 * source), and forbids moving a president (change the captain first, so no team
 * is left without one).
 */
export async function adminMoveMember(userId: string, fromTeamId: string, toTeamId: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  if (fromTeamId === toTeamId) return { error: "Source and destination teams are the same." };
  const adminClient = createAdminClient();

  const { data: fromTeam } = await adminClient
    .from("teams")
    .select("president_user_id")
    .eq("id", fromTeamId)
    .single();
  if (!fromTeam) return { error: "Source team not found." };

  const { data: toTeam } = await adminClient.from("teams").select("id").eq("id", toTeamId).single();
  if (!toTeam) return { error: "Destination team not found." };

  const { data: membership } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", fromTeamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return { error: "That user is not on the source team." };

  if (fromTeam.president_user_id === userId) {
    return { error: "Cannot move the team captain. Assign a new captain first." };
  }

  // Moving a member out is a removal for the source team, so it must keep at
  // least MIN_TEAM_SIZE members (mirrors adminRemoveMember).
  const { data: fromMembers } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", fromTeamId);
  if ((fromMembers?.length ?? 0) - 1 < MIN_TEAM_SIZE) {
    return {
      error: `Moving this member would leave fewer than ${MIN_TEAM_SIZE} members on the source team.`,
    };
  }
  // NOTE: this source-size check is check-then-act, like adminRemoveMember. Two
  // admins concurrently moving different members off the same source team could
  // each pass and drop it below MIN_TEAM_SIZE. Unlike remove (which compensates
  // with a single re-insert), a move spans two teams, so post-hoc compensation
  // is multi-step and itself error-prone. Given this is an admin-only, doubly-
  // rare exception path and the breach is visible + correctable, we accept the
  // residual race here rather than add a transactional RPC. Revisit if moves
  // ever become high-frequency.

  // Already on destination?
  const { data: dupe } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", toTeamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (dupe) return { error: "That user is already on the destination team." };

  // Destination size guardrail.
  const { data: toMembers } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", toTeamId);
  if ((toMembers?.length ?? 0) >= MAX_TEAM_SIZE) {
    return { error: `Destination team is full (${MAX_TEAM_SIZE} members max).` };
  }

  // Move = insert into destination, delete from source.
  const { error: insErr } = await adminClient
    .from("team_members")
    .insert({ team_id: toTeamId, user_id: userId, role: "member" });
  if (insErr) return { error: insErr.message };
  const { error: delErr } = await adminClient
    .from("team_members")
    .delete()
    .eq("team_id", fromTeamId)
    .eq("user_id", userId);
  if (delErr) return { error: delErr.message };

  const actorId = await getAdminUserId();
  logEvent({
    action: "team.member_moved",
    entityType: "team",
    entityId: toTeamId,
    actorId,
    actorType: "admin",
    delta: { moved: { user_id: userId, from_team: fromTeamId, to_team: toTeamId } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

/**
 * Change a participant's email. Updates BOTH the Supabase auth user (so login /
 * password recovery keep working) and profiles.email, so the two never diverge.
 * Refuses if the new email is already taken.
 */
export async function adminChangeUserEmail(userId: string, newEmail: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };
  const normalized = newEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return { error: "Enter a valid email address." };
  }
  const adminClient = createAdminClient();

  const { data: profile } = await adminClient
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { error: "User not found." };
  const oldEmail = profile.email as string;
  if (oldEmail?.toLowerCase() === normalized) {
    return { error: "That is already this user's email." };
  }

  // Conflict check: the new email must not belong to another profile.
  const { data: taken } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", normalized)
    .neq("id", userId)
    .maybeSingle();
  if (taken) return { error: `${normalized} is already used by another account.` };

  // Update the auth user first (source of truth for login). email_confirm keeps
  // the new address usable immediately without a re-confirmation round-trip.
  const { error: authErr } = await adminClient.auth.admin.updateUserById(userId, {
    email: normalized,
    email_confirm: true,
  });
  if (authErr) return { error: `Could not update login email: ${authErr.message}` };

  // Then mirror into the profile row.
  const { error: profErr } = await adminClient
    .from("profiles")
    .update({ email: normalized })
    .eq("id", userId);
  const actorId = await getAdminUserId();
  if (profErr) {
    // Roll the auth change back so login and profile don't diverge. GoTrue admin
    // methods resolve with { error } (they don't throw), so capture it: if the
    // rollback ALSO fails, the two stores are now inconsistent — record that
    // loudly in the audit log so it can be reconciled, and tell the admin.
    const { error: rollbackErr } = await adminClient.auth.admin.updateUserById(userId, {
      email: oldEmail,
    });
    if (rollbackErr) {
      logEvent({
        action: "user.email_change_diverged",
        entityType: "profile",
        entityId: userId,
        actorId,
        actorType: "admin",
        delta: {
          auth_email: { is: normalized },
          profile_email: { is: oldEmail },
          profile_error: profErr.message,
          rollback_error: rollbackErr.message,
        },
      });
      return {
        error:
          `Email change failed AND rollback failed — login email is now "${normalized}" but the ` +
          `profile is "${oldEmail}". This is logged; reconcile manually. (${profErr.message})`,
      };
    }
    return { error: `Could not update profile email: ${profErr.message}` };
  }

  logEvent({
    action: "user.email_changed",
    entityType: "profile",
    entityId: userId,
    actorId,
    actorType: "admin",
    delta: { from: { email: oldEmail }, to: { email: normalized } },
  });

  revalidatePath("/admin/teams");
  return { success: true };
}

// ─── Admin: override a team's challenge selection ─────────
//
// Lets an admin fix a team's challenge for a chapter: ASSIGN one to a team that
// forgot to pick before the deadline, or CHANGE an existing pick to a different
// challenge. Allowed ONLY while submissions are still open for the chapter —
// once the chapter has moved on (pitching/completed) or the submission deadline
// has passed, the override is rejected. The constraint is enforced SERVER-SIDE.
//
// The team→challenge link lives in challenge_registrations, UNIQUE on
// (chapter_id, team_id), so a team has at most one challenge per chapter. We
// UPSERT on that pair: assign inserts a new row, change updates the existing one
// (never a duplicate). Data integrity on a CHANGE: submissions are keyed by
// (challenge_id, team_id), so moving the team to a different challenge would
// orphan any existing submission under the old challenge. Rather than silently
// corrupt that linkage, we BLOCK the change when such a submission exists and
// tell the admin to delete it first.

/** Chapter statuses during which the challenge override is still permitted. */
const CHALLENGE_OVERRIDE_OPEN_STATUSES: ReadonlySet<ChapterStatus> = new Set([
  "challenge_selection",
  "hacking",
  "submissions_open",
]);

export async function adminSetTeamChallenge(
  teamId: string,
  challengeId: string,
  chapterId: string
) {
  if (!teamId || !challengeId || !chapterId) {
    return { error: "Team, challenge, and chapter are required." };
  }
  // Chapter-scoped guard: a local (chapter) admin may only override teams in
  // their OWN chapter; a global admin passes for any chapter. requireAdminAction
  // would let a chapter admin act on another chapter's teams.
  const adminErr = await requireChapterAdminAction(chapterId);
  if (adminErr) return { error: adminErr };
  const adminClient = createAdminClient();

  // 1. Chapter must exist and still allow the override (submissions open).
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("status, submission_deadline")
    .eq("id", chapterId)
    .single();
  if (!chapter) return { error: "Chapter not found." };

  if (!CHALLENGE_OVERRIDE_OPEN_STATUSES.has(chapter.status as ChapterStatus)) {
    return {
      error:
        "Submissions are closed for this chapter. The challenge can no longer be changed.",
    };
  }
  if (
    chapter.submission_deadline &&
    new Date(chapter.submission_deadline as string) <= new Date()
  ) {
    return {
      error:
        "The submission deadline has passed. The challenge can no longer be changed.",
    };
  }

  // 2. Team must belong to this chapter's event. There is no direct team↔chapter
  //    link, so "belongs to the chapter" means the team has at least one member
  //    who is an applicant (any status) for this chapter. This keeps an admin
  //    from attaching an unrelated team to the chapter by mistake.
  const { data: team } = await adminClient
    .from("teams")
    .select("id, name")
    .eq("id", teamId)
    .single();
  if (!team) return { error: "Team not found." };

  const { data: members } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  const memberIds = (members ?? []).map((m) => m.user_id as string);
  if (memberIds.length === 0) {
    return { error: "That team has no members." };
  }

  const { data: memberProfiles } = await adminClient
    .from("profiles")
    .select("email")
    .in("id", memberIds);
  const memberEmails = (memberProfiles ?? [])
    .map((p) => p.email as string | null)
    .filter((e): e is string => !!e);

  let teamInChapter = false;
  if (memberEmails.length > 0) {
    // Require an ACCEPTED/checked-in applicant, not just any application: a
    // rejected/waitlisted/cancelled row must not make a team "part of" the
    // chapter (consistent with the registration paths, which key off checked-in
    // roster members).
    const { data: app } = await adminClient
      .from("applications")
      .select("id")
      .eq("chapter_id", chapterId)
      .in("email", memberEmails)
      .in("status", ["accepted", "checked_in"])
      .limit(1)
      .maybeSingle();
    teamInChapter = !!app;
  }
  if (!teamInChapter) {
    return { error: "That team is not part of this chapter's event." };
  }

  // 3. Challenge must belong to this chapter.
  const { data: challenge } = await adminClient
    .from("challenges")
    .select("id, title")
    .eq("id", challengeId)
    .eq("chapter_id", chapterId)
    .maybeSingle();
  if (!challenge) {
    return { error: "That challenge does not belong to this chapter." };
  }

  // 4. Look at the current registration (if any) to decide assign vs. change.
  const { data: existing } = await adminClient
    .from("challenge_registrations")
    .select("id, challenge_id, roster")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .maybeSingle();

  const fromChallengeId = (existing?.challenge_id as string | null) ?? null;
  if (existing && fromChallengeId === challengeId) {
    return { error: "The team is already registered for that challenge." };
  }

  // 5. Data integrity on a CHANGE: a submission under the OLD challenge would be
  //    orphaned. Block and ask the admin to remove it first rather than corrupt
  //    the submission↔challenge linkage.
  if (existing && fromChallengeId && fromChallengeId !== challengeId) {
    const { data: oldSubmission } = await adminClient
      .from("submissions")
      .select("id")
      .eq("challenge_id", fromChallengeId)
      .eq("team_id", teamId)
      .maybeSingle();
    if (oldSubmission) {
      return {
        error:
          "This team already submitted a project to its current challenge. " +
          "Delete that submission before changing the challenge.",
      };
    }
  }

  // 6. Upsert the registration on (chapter_id, team_id): assign or change.
  if (existing) {
    // Conditional update: only change the row if its challenge is STILL the one
    // we validated against above. If a concurrent override (or registration)
    // changed it in the meantime, this updates 0 rows and we abort instead of
    // applying a stale change that could orphan a submission. (The submission
    // block in step 5 is otherwise check-then-act.)
    const { data: updated, error } = await adminClient
      .from("challenge_registrations")
      .update({ challenge_id: challengeId })
      .eq("id", existing.id as string)
      .eq("challenge_id", fromChallengeId as string)
      .select("id");
    if (error) return { error: error.message };
    if (!updated || updated.length === 0) {
      return {
        error:
          "This team's challenge changed while you were editing. Reload and try again.",
      };
    }
  } else {
    // Seed the roster from the team's members so downstream flows (pitch order,
    // submission gating) see a populated roster, mirroring registerForChallenge.
    const { error } = await adminClient.from("challenge_registrations").insert({
      chapter_id: chapterId,
      challenge_id: challengeId,
      team_id: teamId,
      roster: memberIds,
    });
    if (error) return { error: error.message };
  }

  // 7. Audit log (strict: an override of a participant choice must not be lost).
  const actorId = await getAdminUserId();
  await logEventStrict({
    action: "challenge_registration.admin_override",
    entityType: "challenge_registration",
    entityId: teamId,
    actorId,
    actorType: "admin",
    delta: {
      chapter_id: chapterId,
      team: team.name ?? teamId,
      challenge: { from: fromChallengeId, to: challengeId },
    },
  });

  revalidatePath("/admin/teams");
  revalidatePath(`/admin/chapters/${chapterId}`);
  revalidatePath("/matches");
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

  // Collect one send-job per member first, then run them with bounded
  // concurrency: one email per member multiplies the send count by team size,
  // and a strictly sequential SMTP loop could blow the 60s function timeout on
  // a large chapter (leaving later teams unemailed with no audit row).
  const sendJobs: (() => Promise<void>)[] = [];

  for (const score of scores) {
    const teamId = score.team_id as string;

    // Get team members with their email addresses (user_id is needed to mint
    // each member's personal certificate link)
    const { data: members } = await adminClient
      .from("team_members")
      .select("user_id, profiles(email, name)")
      .eq("team_id", teamId);

    // Get team name
    const { data: team } = await adminClient
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .single();

    if (!team || !members) continue;

    const placement = score.placement as number | null;
    const isPlaced = isPlacedPlacement(placement);
    // Participation certificates carry no points; only placed teams see them.
    const resultLabel = isPlaced
      ? `${getPlacementLabel(placement as number)} Place (+${score.points as number} pts)`
      : "Participant";
    const defaultVariant = isPlaced ? ("achievement" as const) : ("participation" as const);

    // Unguessable capability tokens so the links work without login while
    // staying bound to exactly one certificate each. The team link keeps the
    // legacy v1 shape (same URL as previously emailed links); the personal and
    // participation links use v2 tokens scoped to their (member, variant). See
    // lib/certificate-token.ts.
    const routeUrl = `${baseUrl}/api/certificates/${chapterId}/${teamId}`;
    const teamCertificateUrl = `${routeUrl}?token=${certificateToken(chapterId, teamId)}`;
    const participationCertificateUrl = isPlaced
      ? `${routeUrl}?variant=participation&token=${certificateTokenV2(chapterId, teamId, { variant: "participation" })}`
      : null;

    // One email per member: each carries that member's own personal
    // certificate link, so recipients can no longer share a single message.
    for (const m of members) {
      const userId = m.user_id as string;
      const profile = m.profiles as unknown as { email: string | null; name: string | null } | null;
      if (!profile?.email) continue;
      const email = profile.email;

      // The personal variant prints the member's name; without one there is
      // nothing to certify, so offer only the team certificate(s).
      const personalCertificateUrl = profile.name
        ? `${routeUrl}?variant=${defaultVariant}&member=${userId}&token=${certificateTokenV2(chapterId, teamId, { variant: defaultVariant, memberId: userId })}`
        : null;

      sendJobs.push(async () => {
        try {
          const html = await renderCertificateEmail({
            memberName: profile.name ?? null,
            teamName: team.name as string,
            chapterName: chapter.name as string,
            chapterCity,
            chapterDate,
            resultLabel,
            personalCertificateUrl,
            teamCertificateUrl,
            participationCertificateUrl,
          });

          await sendEmail({
            to: email,
            subject: `Your EHL Certificates: ${chapter.name as string}`,
            html,
          });
          sent++;
        } catch (err) {
          console.error(
            `Failed to send certificate email to a member of team ${teamId}:`,
            err
          );
          failed++;
        }
      });
    }
  }

  // Every job catches its own error, so a failed send never stops the batch.
  await runWithConcurrency(sendJobs, 5);

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
