import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";
import {
  getScoresForChapter,
  getMediaForChapter,
  getChapterByIdAdmin,
} from "@/lib/queries/chapters";
import { hasSponsorConsent, SPONSOR_CONSENT_OR_FILTER } from "@/lib/showcase-shared";
import type { ApplicationFormData, Chapter, MediaItem } from "@/lib/types";

// ─── Sponsor-facing view of a chapter ────────────────────────
//
// This is what a partner sees on the token-gated showcase page. It is assembled
// with the service-role client because the public showcase page has no session:
// the unguessable token IS the authorization, resolved upstream by
// getShowcaseByToken(). Every applicant here has already passed the sponsor
// consent gate (see SPONSOR_CONSENT_OR_FILTER / hasSponsorConsent).

export type ShowcaseApplicantStatus = "applied" | "accepted" | "participated";

export interface ShowcaseApplicant {
  id: string; // application id — the CV proxy is keyed by this, never the Drive fileId
  firstName: string;
  lastName: string;
  linkedIn: string | null;
  github: string | null;
  hasCv: boolean;
  status: ShowcaseApplicantStatus;
  checkedIn: boolean;
}

export interface ShowcaseRankingRow {
  teamId: string;
  teamName: string;
  placement: number | null; // null = participated, not placed top-5
  points: number;
}

export interface ShowcaseData {
  chapter: Chapter | null;
  applicants: ShowcaseApplicant[];
  applicantsTruncated: boolean;
  participantCount: number; // how many of the visible applicants actually checked in
  ranking: ShowcaseRankingRow[];
  photos: MediaItem[];
  photosTruncated: boolean;
}

// Map an application status to the sponsor-visible label. checked_in => the
// person actually showed up ("participated"); accepted but not checked in =>
// "accepted"; everything else (pending/rejected/waitlisted/cancelled) collapses
// to the neutral "applied" so a sponsor never sees an internal decision like
// "rejected" against a person's name.
function labelFor(status: string): ShowcaseApplicantStatus {
  if (status === "checked_in") return "participated";
  if (status === "accepted") return "accepted";
  return "applied";
}

export async function getShowcaseData(chapterId: string): Promise<ShowcaseData> {
  const supabase = createAdminClient();

  // Applicants: consented only, capped at the applications limit. We request one
  // extra row to detect truncation for the LimitBanner.
  const appLimit = QUERY_LIMITS.applicationsPerChapter;
  const { data: appRows } = await supabase
    .from("applications")
    .select(
      "id, first_name, last_name, status, cv_url, checked_in_at, form_data, consent_sponsor_data, consent_recruiting"
    )
    .eq("chapter_id", chapterId)
    .or(SPONSOR_CONSENT_OR_FILTER)
    .order("checked_in_at", { ascending: false, nullsFirst: false })
    .order("last_name", { ascending: true })
    .limit(appLimit + 1);

  const rows = appRows ?? [];
  const applicantsTruncated = rows.length > appLimit;
  const applicants: ShowcaseApplicant[] = rows.slice(0, appLimit).map((row) => {
    const formData = (row.form_data as ApplicationFormData) ?? ({} as ApplicationFormData);
    // Defence in depth: never trust the DB filter alone. Re-assert consent in
    // code so a query mistake cannot leak an unconsented applicant.
    const consented = hasSponsorConsent({
      consentSponsorData: row.consent_sponsor_data as boolean | null,
      consentRecruiting: row.consent_recruiting as boolean | null,
    });
    if (!consented) return null;
    return {
      id: row.id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      linkedIn: formData.linkedIn ?? null,
      github: formData.github ?? null,
      hasCv: Boolean(row.cv_url),
      status: labelFor(row.status as string),
      checkedIn: Boolean(row.checked_in_at),
    };
  }).filter((a): a is ShowcaseApplicant => a !== null);

  // Ranking: published scores for the chapter, joined to team names. getScores
  // returns unpublished rows too, so we filter to published and resolve names.
  const scores = await getScoresForChapter(chapterId);
  const teamIds = scores.map((s) => s.teamId);
  const teamNames = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teamRows } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIds)
      .limit(QUERY_LIMITS.teams);
    for (const t of teamRows ?? []) {
      teamNames.set(t.id as string, t.name as string);
    }
  }
  const ranking: ShowcaseRankingRow[] = scores
    .map((s) => ({
      teamId: s.teamId,
      teamName: teamNames.get(s.teamId) ?? "Unknown team",
      placement: s.placement,
      points: s.points,
    }))
    // scores already ordered by placement asc nulls last in getScoresForChapter
    .filter((r) => teamNames.has(r.teamId));

  // Photos: reuse the existing chapter media query (featured first). Cap for the
  // LimitBanner.
  const allPhotos = (await getMediaForChapter(chapterId)).filter(
    (m) => m.type === "photo"
  );
  const photosTruncated = allPhotos.length > QUERY_LIMITS.media;
  const photos = allPhotos.slice(0, QUERY_LIMITS.media);

  const chapter = await getChapterByIdAdmin(chapterId);
  const participantCount = applicants.filter((a) => a.checkedIn).length;

  return {
    chapter,
    applicants,
    applicantsTruncated,
    participantCount,
    ranking,
    photos,
    photosTruncated,
  };
}

// ─── Admin: consent/visibility counts for a chapter ─────────
//
// Powers the admin showcase page so an operator sees EXACTLY what a sponsor will
// see before sharing the link: how many applicants total, how many are hidden
// because they did not opt into sharing with sponsors, and how many CVs are
// available among the visible set. All uses the service-role client; the caller
// (admin page/action) is admin-guarded.
export interface ShowcaseCounts {
  total: number; // all applications for the chapter
  visible: number; // applicants who passed the sponsor consent gate
  hiddenNoConsent: number; // total - visible
  participants: number; // visible applicants who checked in
  cvsAvailable: number; // visible applicants with a CV
}

export async function getShowcaseCounts(chapterId: string): Promise<ShowcaseCounts> {
  const supabase = createAdminClient();

  const { count: total } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("chapter_id", chapterId);

  const { data: visibleRows } = await supabase
    .from("applications")
    .select("cv_url, checked_in_at, consent_sponsor_data, consent_recruiting")
    .eq("chapter_id", chapterId)
    .or(SPONSOR_CONSENT_OR_FILTER)
    .limit(QUERY_LIMITS.applicationsPerChapter);

  const visible = (visibleRows ?? []).filter((r) =>
    hasSponsorConsent({
      consentSponsorData: r.consent_sponsor_data as boolean | null,
      consentRecruiting: r.consent_recruiting as boolean | null,
    })
  );
  const participants = visible.filter((r) => Boolean(r.checked_in_at)).length;
  const cvsAvailable = visible.filter((r) => Boolean(r.cv_url)).length;
  const totalCount = total ?? 0;

  return {
    total: totalCount,
    visible: visible.length,
    hiddenNoConsent: Math.max(0, totalCount - visible.length),
    participants,
    cvsAvailable,
  };
}

// ─── CV access check (used by the CV proxy) ──────────────────
//
// Given a chapter and an application id, return the Drive fileId ONLY if that
// application belongs to the chapter, has a CV, and passes the sponsor consent
// gate. Returns null uniformly otherwise (no oracle: "wrong chapter", "no such
// application", "no consent", "no CV" are indistinguishable to the caller). This
// is the exact same consent gate the list uses, so a person hidden from the list
// can never have their CV fetched — and a token for chapter A can never resolve
// an application id from chapter B.
export async function getShowcaseCvFileId(
  chapterId: string,
  applicationId: string
): Promise<string | null> {
  if (!applicationId) return null;
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("applications")
    .select("cv_url, consent_sponsor_data, consent_recruiting")
    .eq("id", applicationId)
    .eq("chapter_id", chapterId) // IDOR guard: the id must belong to THIS chapter
    .maybeSingle();

  if (!row?.cv_url) return null;
  const consented = hasSponsorConsent({
    consentSponsorData: row.consent_sponsor_data as boolean | null,
    consentRecruiting: row.consent_recruiting as boolean | null,
  });
  if (!consented) return null;
  return row.cv_url as string;
}
