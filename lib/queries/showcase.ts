import { createAdminClient } from "@/lib/supabase/admin";
import { getClient } from "@/lib/queries/client";
import { toChapter, toMediaItem, toScore } from "@/lib/queries/mappers";
import { QUERY_LIMITS } from "@/lib/config/limits";
import {
  buildTeamNameByEmail,
  rowHasSponsorConsent,
  SPONSOR_CONSENT_OR_FILTER,
} from "@/lib/showcase-shared";
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
  // The team this person PLAYED ON at this chapter, resolved from
  // challenge_registrations.roster (chapter-scoped, written from real checked-in
  // members). null = never on a registered team at this event. Deliberately NOT
  // the person's current global team, which may pre/post-date the event.
  teamName: string | null;
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
        // email is used ONLY server-side to bridge to the roster (below); it is
        // never put on ShowcaseApplicant and never reaches the sponsor.
        "id, email, first_name, last_name, status, cv_url, checked_in_at, consent_sponsor_data, consent_recruiting, linkedIn:form_data->>linkedIn, github:form_data->>github"
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

  // Applicant -> event team, via challenge_registrations.roster (profile ids of
  // the members who actually played) -> profiles.email -> applications.email.
  // Two batched queries; roster ids are bounded by this chapter's registrations
  // (~5 per team), so the .in() stays tiny. Applicants without an account, a
  // team, or a registration naturally resolve to null.
  const { data: regs, error: regError } = await supabase
    .from("challenge_registrations")
    .select("team_id, roster, teams!inner(name)")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.challengeRegistrations);
  if (regError) throw regError;

  const rosterRegs = (regs ?? []).map((reg) => ({
    teamName: (reg.teams as unknown as { name: string }).name,
    roster: ((reg.roster as string[]) ?? []).filter((v) => typeof v === "string"),
  }));
  const rosterUserIds = [...new Set(rosterRegs.flatMap((r) => r.roster))];
  // Chunked .in(): PostgREST filters ride in the GET URL, and at the
  // registration cap the roster set could reach thousands of UUIDs — far past
  // safe URL length. 200 ids/request keeps each URL ~7KB.
  const profileRows: Array<{ id: string; email: string | null }> = [];
  for (let i = 0; i < rosterUserIds.length; i += 200) {
    const { data: profs, error: profError } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", rosterUserIds.slice(i, i + 200));
    if (profError) throw profError;
    for (const p of profs ?? []) {
      profileRows.push({ id: p.id as string, email: (p.email as string) ?? null });
    }
  }
  const teamNameByEmail = buildTeamNameByEmail(rosterRegs, profileRows);

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
        teamName:
          teamNameByEmail.get(((row.email as string) ?? "").toLowerCase()) ?? null,
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

// ─── Bulk CV list (used by the ZIP download) ─────────────────
//
// Every consented applicant of the chapter who has a CV — the EXACT same
// consent gate as the list and the single-CV proxy (DB .or() filter plus the
// in-code re-check), so the ZIP can never contain a CV the page would hide.
export interface ShowcaseCvEntry {
  firstName: string;
  lastName: string;
  fileId: string;
}

export async function getShowcaseCvList(chapterId: string): Promise<ShowcaseCvEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("applications")
    .select("first_name, last_name, cv_url, consent_sponsor_data, consent_recruiting")
    .eq("chapter_id", chapterId)
    .or(SPONSOR_CONSENT_OR_FILTER)
    .not("cv_url", "is", null)
    .order("last_name", { ascending: true })
    .limit(QUERY_LIMITS.applicationsPerChapter);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => rowHasSponsorConsent(row))
    .map((row) => ({
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      fileId: row.cv_url as string,
    }));
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

// ─── Bulk photo list (used by the photo ZIP download) ────────
//
// Every gallery photo of the chapter, in the same order the showcase renders
// them (featured first). No consent gate: these are event photos, not personal
// documents. The Drive fileId is `url` (media rows store the bare id). Capped at
// the same media limit as the page so the ZIP and the visible gallery agree.
export interface ShowcasePhotoEntry {
  fileId: string;
  caption: string | null;
}

export async function getShowcasePhotoList(chapterId: string): Promise<ShowcasePhotoEntry[]> {
  const anon = getClient();
  const { data, error } = await anon
    .from("media")
    .select("url, caption, type")
    .eq("chapter_id", chapterId)
    .eq("type", "photo")
    .order("featured", { ascending: false })
    .limit(QUERY_LIMITS.media);
  if (error) throw error;

  return (data ?? [])
    .filter((row) => row.type === "photo" && Boolean(row.url))
    .map((row) => ({
      fileId: row.url as string,
      caption: (row.caption as string | null) ?? null,
    }));
}

// ─── Photo fileId validation (used by the photo ZIP for a selection) ──
//
// Return the set of the requested fileIds that are genuinely gallery photos of
// THIS chapter. The client sends a caller-controlled list of ids to download;
// without this filter it could smuggle any Drive id (e.g. a CV) into the photo
// ZIP. We resolve the chapter's real photo ids server-side and intersect, so an
// id that is not a photo of this chapter is silently dropped, never fetched.
export async function filterChapterPhotoFileIds(
  chapterId: string,
  requestedFileIds: string[]
): Promise<string[]> {
  if (requestedFileIds.length === 0) return [];
  const requested = new Set(requestedFileIds);
  const photos = await getShowcasePhotoList(chapterId);
  const valid = new Set(photos.map((p) => p.fileId));
  // Preserve the chapter's gallery order (featured first), not the request order.
  return photos.map((p) => p.fileId).filter((id) => requested.has(id) && valid.has(id));
}
