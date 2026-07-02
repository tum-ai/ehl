import { createAdminClient } from "@/lib/supabase/admin";
import { getClient } from "@/lib/queries/client";
import { toChapter, toMediaItem, toScore } from "@/lib/queries/mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { rowHasSponsorConsent, SPONSOR_CONSENT_OR_FILTER } from "@/lib/showcase-shared";
import type { ApplicationStatus, Chapter, MediaItem } from "@/lib/types";

// ─── Sponsor-facing view of a chapter ────────────────────────
//
// This is what a partner sees on the token-gated showcase page. It is assembled
// with the service-role client because the public showcase page has no session:
// the unguessable token IS the authorization, resolved upstream by
// getShowcaseByToken(). Every applicant here has already passed the sponsor
// consent gate (see SPONSOR_CONSENT_OR_FILTER / rowHasSponsorConsent).

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
  // Placements are assigned PER CHALLENGE (finalizeChallengeScores), so a
  // multi-challenge chapter legitimately has several placement=1 rows. The view
  // needs the challenge name to label them (and to know the podium, which
  // assumes unique placements, doesn't apply).
  challengeName: string;
}

export interface ShowcaseData {
  chapter: Chapter | null;
  applicants: ShowcaseApplicant[];
  applicantsTruncated: boolean;
  ranking: ShowcaseRankingRow[];
  rankingTruncated: boolean;
  photos: MediaItem[];
  photosTruncated: boolean;
  // Server-computed limits for the client's LimitBanner. QUERY_LIMITS reads
  // process.env dynamically, which is NOT inlined into the client bundle — a
  // client component would silently fall back to the defaults and disagree with
  // the server whenever a LIMIT_* override is set (hydration mismatch, banner
  // vanishing). So the client must never import QUERY_LIMITS; it renders from
  // these values.
  limits: { applicants: number; photos: number };
}

// Map an application status to the sponsor-visible label. checked_in => the
// person actually showed up ("participated"); accepted but not checked in =>
// "accepted"; everything else (pending/rejected/waitlisted/cancelled) collapses
// to the neutral "applied" so a sponsor never sees an internal decision like
// "rejected" against a person's name.
//
// Exhaustive over ApplicationStatus: adding a new status to the enum fails
// compilation here, forcing an explicit decision about sponsor visibility
// instead of a silent fall-through.
function labelFor(status: ApplicationStatus): ShowcaseApplicantStatus {
  switch (status) {
    case "checked_in":
      return "participated";
    case "accepted":
      return "accepted";
    case "pending":
    case "rejected":
    case "waitlisted":
    case "cancelled":
      return "applied";
  }
}

export async function getShowcaseData(chapterId: string): Promise<ShowcaseData> {
  const supabase = createAdminClient();
  // Anon client for scores/media: the "Public read published scores" RLS policy
  // (published = true) filters unpublished/draft rankings server-side. Do NOT
  // switch these to the admin client without an explicit .eq("published", true)
  // filter, or draft rankings would leak to sponsors.
  const anon = getClient();
  const appLimit = QUERY_LIMITS.applicationsPerChapter;

  // The four root queries are independent — run them together. Only the
  // team-name lookup (below) depends on the scores result. Queried directly
  // (not via the shared get* helpers, which swallow errors): a DB failure must
  // surface as an error page, not render a plausible-looking showcase claiming
  // "0 applicants" or an empty ranking to a sponsor.
  const [appResult, scoresResult, mediaResult, chapterResult] = await Promise.all([
    // Applicants: consented only, capped at the applications limit. One extra
    // row detects truncation for the LimitBanner. Select ONLY what the sponsor
    // view renders — form_data holds ~25 fields including sensitive ones
    // (dateOfBirth, dietary restrictions), so pull the two profile URLs out of
    // the JSONB server-side instead of shipping whole blobs for 2000 rows.
    supabase
      .from("applications")
      .select(
        "id, first_name, last_name, status, cv_url, checked_in_at, consent_sponsor_data, consent_recruiting, linkedIn:form_data->>linkedIn, github:form_data->>github"
      )
      .eq("chapter_id", chapterId)
      .or(SPONSOR_CONSENT_OR_FILTER)
      .order("checked_in_at", { ascending: false, nullsFirst: false })
      .order("last_name", { ascending: true })
      .limit(appLimit + 1),
    anon
      .from("scores")
      .select("*")
      .eq("chapter_id", chapterId)
      .order("placement", { ascending: true, nullsFirst: false }),
    anon
      .from("media")
      .select("*")
      .eq("chapter_id", chapterId)
      .order("featured", { ascending: false }),
    // Admin client: the chapter may not be publicly readable yet (draft), but
    // the admin explicitly enabled its showcase.
    supabase.from("chapters").select("*").eq("id", chapterId).maybeSingle(),
  ]);

  if (appResult.error) throw appResult.error;
  if (scoresResult.error) throw scoresResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (chapterResult.error) throw chapterResult.error;

  const scores = (scoresResult.data ?? []).map(toScore);
  const allMedia = (mediaResult.data ?? []).map(toMediaItem);
  const chapter = chapterResult.data ? toChapter(chapterResult.data) : null;

  const rows = appResult.data ?? [];
  const applicantsTruncated = rows.length > appLimit;
  const applicants: ShowcaseApplicant[] = rows
    .slice(0, appLimit)
    .map((row) => {
      // Defence in depth: never trust the DB filter alone. Re-assert consent in
      // code so a query mistake cannot leak an unconsented applicant.
      if (!rowHasSponsorConsent(row)) return null;
      return {
        id: row.id as string,
        firstName: row.first_name as string,
        lastName: row.last_name as string,
        linkedIn: (row.linkedIn as string | null) ?? null,
        github: (row.github as string | null) ?? null,
        hasCv: Boolean(row.cv_url),
        status: labelFor(row.status as ApplicationStatus),
        checkedIn: Boolean(row.checked_in_at),
      };
    })
    .filter((a): a is ShowcaseApplicant => a !== null);

  // Resolve team names for the ranking. Bounded by the scores of ONE chapter,
  // but still capped per the QUERY_LIMITS rule — and if that cap ever bites, we
  // surface it (rankingTruncated) instead of silently dropping placed teams.
  const teamIds = scores.map((s) => s.teamId);
  const teamNames = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: teamRows, error: teamError } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIds)
      .limit(QUERY_LIMITS.teams);
    if (teamError) throw teamError;
    for (const t of teamRows ?? []) {
      teamNames.set(t.id as string, t.name as string);
    }
  }
  const ranking: ShowcaseRankingRow[] = scores
    .map((s) => ({
      teamId: s.teamId,
      teamName: teamNames.get(s.teamId) ?? "",
      placement: s.placement,
      points: s.points,
      challengeName: s.challengeName,
    }))
    // scores already ordered by placement asc nulls last (query above)
    .filter((r) => r.teamName !== "");
  const rankingTruncated = ranking.length < scores.length;

  // Photos: featured first (media query order). Cap for the LimitBanner.
  const allPhotos = allMedia.filter((m) => m.type === "photo");
  const photosTruncated = allPhotos.length > QUERY_LIMITS.media;
  const photos = allPhotos.slice(0, QUERY_LIMITS.media);

  return {
    chapter,
    applicants,
    applicantsTruncated,
    ranking,
    rankingTruncated,
    photos,
    photosTruncated,
    limits: { applicants: appLimit, photos: QUERY_LIMITS.media },
  };
}

// ─── Admin: consent/visibility counts for a chapter ─────────
//
// Powers the admin showcase page so an operator sees EXACTLY what a sponsor will
// see before sharing the link: how many applicants total, how many are hidden
// because they did not opt into sharing with sponsors, and how many CVs are
// available among the visible set. Four head-only COUNT queries in parallel —
// exact at any scale (no row transfer, no LIMIT clipping that would misattribute
// truncated-but-consented applicants as "no consent"). All uses the service-role
// client; the caller (admin page/action) is admin-guarded.
export interface ShowcaseCounts {
  total: number; // all applications for the chapter
  visible: number; // applicants who passed the sponsor consent gate
  hiddenNoConsent: number; // total - visible
  participants: number; // visible applicants who checked in
  cvsAvailable: number; // visible applicants with a CV
}

export async function getShowcaseCounts(chapterId: string): Promise<ShowcaseCounts> {
  const supabase = createAdminClient();

  const base = () =>
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapterId);

  const [totalRes, visibleRes, participantsRes, cvsRes] = await Promise.all([
    base(),
    base().or(SPONSOR_CONSENT_OR_FILTER),
    base().or(SPONSOR_CONSENT_OR_FILTER).not("checked_in_at", "is", null),
    base().or(SPONSOR_CONSENT_OR_FILTER).not("cv_url", "is", null),
  ]);

  for (const res of [totalRes, visibleRes, participantsRes, cvsRes]) {
    if (res.error) throw res.error;
  }

  const total = totalRes.count ?? 0;
  const visible = visibleRes.count ?? 0;

  return {
    total,
    visible,
    hiddenNoConsent: Math.max(0, total - visible),
    participants: participantsRes.count ?? 0,
    cvsAvailable: cvsRes.count ?? 0,
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
  const { data: row, error } = await supabase
    .from("applications")
    .select("cv_url, consent_sponsor_data, consent_recruiting")
    .eq("id", applicationId)
    .eq("chapter_id", chapterId) // IDOR guard: the id must belong to THIS chapter
    .or(SPONSOR_CONSENT_OR_FILTER) // consent gate at the DB layer (same as the list)
    .maybeSingle();

  // A DB failure is a 500, not the uniform 404: an outage must not read as
  // "this CV does not exist".
  if (error) throw error;

  if (!row?.cv_url) return null;
  // Defence in depth: re-assert consent in code so a query mistake cannot leak a
  // CV even if the .or() filter above were ever weakened.
  if (!rowHasSponsorConsent(row)) return null;
  return row.cv_url as string;
}
