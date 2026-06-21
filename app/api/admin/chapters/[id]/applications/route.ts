import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApplicationFormData, ApplicationTeamMember } from "@/lib/types";
import { extractLinkedInUsername, extractGitHubUsername, normalizeName, findBestNameMatch } from "@/lib/flag-utils";
import { QUERY_LIMITS } from "@/lib/config/limits";

function toApplication(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    chapterId: row.chapter_id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    status: row.status as string,
    formData: (row.form_data as ApplicationFormData) ?? ({} as ApplicationFormData),
    cvUrl: (row.cv_url as string) ?? null,
    existingTeamId: (row.existing_team_id as string) ?? null,
    teamMembers: (row.team_members as ApplicationTeamMember[]) ?? [],
    checkInToken: row.check_in_token as string,
    checkedInAt: (row.checked_in_at as string) ?? null,
    checkedInBy: (row.checked_in_by as string) ?? null,
    consentAttendance: row.consent_attendance as boolean,
    consentPrivacy: row.consent_privacy as boolean,
    consentNewsletter: (row.consent_newsletter as boolean) ?? false,
    consentRecruiting: (row.consent_recruiting as boolean) ?? false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    acceptanceEmailSentAt: (row.acceptance_email_sent_at as string) ?? null,
    rejectionEmailSentAt: (row.rejection_email_sent_at as string) ?? null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireChapterAdminApi(id);
  if (denied) return denied;

  const adminClient = createAdminClient();

  // Fetch applications using admin client (bypasses RLS)
  const { data: appRows } = await adminClient
    .from("applications")
    .select("*")
    .eq("chapter_id", id)
    .order("created_at", { ascending: false })
    .limit(QUERY_LIMITS.applicationsPerChapter);

  const applications = (appRows ?? []).map(toApplication);

  const url = new URL(request.url);
  const includeScreening = url.searchParams.get("preparation") === "true";

  if (!includeScreening) {
    return NextResponse.json(applications);
  }

  // ─── Fetch all data in parallel ────────────────────────────
  const [
    { data: allMembers },
    { data: leaderboard },
    { data: allScreeningScores },
    { data: allApplications },
    { data: allSubmissions },
    { data: allRegistrations },
    { data: tumaiMembers },
    { data: activeFlags },
  ] = await Promise.all([
    adminClient.from("team_members").select("team_id, user_id, profiles(email, name)").limit(QUERY_LIMITS.allTeamMembers),
    adminClient.from("leaderboard").select("team_id, team_name, total_points").limit(QUERY_LIMITS.leaderboard),
    adminClient.from("screening_scores").select("application_id, screener_id, score, notes, created_at").limit(QUERY_LIMITS.screeningScores),
    adminClient.from("applications").select("id, email, chapter_id, status, chapters!inner(name)").limit(QUERY_LIMITS.applicationStats),
    adminClient.from("submissions").select("challenge_id, team_id").limit(QUERY_LIMITS.submissionsPerChallenge * 50),
    adminClient.from("challenge_registrations").select("chapter_id, team_id, challenge_id").limit(QUERY_LIMITS.challengeRegistrations),
    adminClient.from("tumai_members").select("email, name").limit(QUERY_LIMITS.profiles),
    adminClient.from("participant_flags").select("id, email, name, linkedin_username, github_username, reason, screenshot_url, created_by, created_at").is("resolved_at", null).limit(QUERY_LIMITS.profiles),
  ]);

  // Signal to the screening UI when any enrichment query likely hit its cap,
  // so it can warn instead of silently computing averages from partial data.
  const screeningTruncated =
    (allScreeningScores?.length ?? 0) >= QUERY_LIMITS.screeningScores ||
    (allApplications?.length ?? 0) >= QUERY_LIMITS.applicationStats;

  // TUM.ai verified emails set
  const tumaiEmails = new Set(
    (tumaiMembers ?? []).map((m) => (m.email as string).toLowerCase())
  );

  // TUM.ai member names for fuzzy matching
  const tumaiNames = (tumaiMembers ?? [])
    .map((m) => (m.name as string | null))
    .filter((n): n is string => !!n);

  // ─── Build flag lookup maps ────────────────────────────────

  // Resolve flag creator names
  const flagCreatorIds = new Set<string>();
  for (const f of activeFlags ?? []) {
    flagCreatorIds.add(f.created_by as string);
  }
  const flagCreatorNames = new Map<string, string>();
  if (flagCreatorIds.size > 0) {
    const { data: creatorProfiles } = await adminClient
      .from("profiles")
      .select("id, name")
      .in("id", [...flagCreatorIds]);
    for (const p of creatorProfiles ?? []) {
      flagCreatorNames.set(p.id as string, (p.name as string) ?? "Unknown");
    }
  }

  type FlagEntry = { id: string; reason: string; screenshotUrl: string | null; createdByName: string; createdAt: string };
  const flagsByEmail = new Map<string, FlagEntry[]>();
  const flagsByLinkedin = new Map<string, FlagEntry[]>();
  const flagsByGithub = new Map<string, FlagEntry[]>();
  const flagsByName = new Map<string, FlagEntry[]>();

  for (const f of activeFlags ?? []) {
    const entry: FlagEntry = {
      id: f.id as string,
      reason: f.reason as string,
      screenshotUrl: (f.screenshot_url as string) ?? null,
      createdByName: flagCreatorNames.get(f.created_by as string) ?? "Unknown",
      createdAt: f.created_at as string,
    };

    const email = (f.email as string).toLowerCase();
    if (!flagsByEmail.has(email)) flagsByEmail.set(email, []);
    flagsByEmail.get(email)!.push(entry);

    const li = f.linkedin_username as string | null;
    if (li) {
      if (!flagsByLinkedin.has(li)) flagsByLinkedin.set(li, []);
      flagsByLinkedin.get(li)!.push(entry);
    }

    const gh = f.github_username as string | null;
    if (gh) {
      if (!flagsByGithub.has(gh)) flagsByGithub.set(gh, []);
      flagsByGithub.get(gh)!.push(entry);
    }

    const name = f.name as string | null;
    if (name) {
      if (!flagsByName.has(name)) flagsByName.set(name, []);
      flagsByName.get(name)!.push(entry);
    }
  }

  // ─── Build lookups ─────────────────────────────────────────

  // Email -> team info (league membership + points)
  const emailToTeam = new Map<string, { teamId: string; teamName: string; totalPoints: number }>();
  if (allMembers && leaderboard) {
    const teamPoints = new Map<string, { teamName: string; totalPoints: number }>();
    for (const entry of leaderboard) {
      teamPoints.set(entry.team_id as string, {
        teamName: entry.team_name as string,
        totalPoints: (entry.total_points as number) ?? 0,
      });
    }
    for (const member of allMembers) {
      const profile = member.profiles as unknown as { email: string | null; name: string | null } | null;
      if (!profile?.email) continue;
      const points = teamPoints.get(member.team_id as string);
      emailToTeam.set(profile.email.toLowerCase(), {
        teamId: member.team_id as string,
        teamName: points?.teamName ?? "Unknown",
        totalPoints: points?.totalPoints ?? 0,
      });
    }
  }

  // Build screener ID -> name map
  const screenerIds = new Set<string>();
  for (const s of allScreeningScores ?? []) {
    screenerIds.add(s.screener_id as string);
  }
  const screenerNames = new Map<string, string>();
  if (screenerIds.size > 0) {
    const { data: screenerProfiles } = await adminClient
      .from("profiles")
      .select("id, name, email")
      .in("id", Array.from(screenerIds));
    for (const p of screenerProfiles ?? []) {
      screenerNames.set(p.id as string, (p.name as string) || (p.email as string) || "Unknown");
    }
  }

  // Screening scores grouped by application_id
  const scoresByApp = new Map<string, { screenerId: string; screenerName: string; score: number; notes: string | null; createdAt: string }[]>();
  for (const s of allScreeningScores ?? []) {
    const appId = s.application_id as string;
    if (!scoresByApp.has(appId)) scoresByApp.set(appId, []);
    scoresByApp.get(appId)!.push({
      screenerId: s.screener_id as string,
      screenerName: screenerNames.get(s.screener_id as string) ?? "Unknown",
      score: s.score as number,
      notes: (s.notes as string) ?? null,
      createdAt: s.created_at as string,
    });
  }

  // Build email -> previous screening scores (from other chapters)
  // and email -> past participations + no-shows
  const emailToAppIds = new Map<string, { appId: string; chapterId: string; chapterName: string; status: string }[]>();
  for (const a of allApplications ?? []) {
    const email = (a.email as string).toLowerCase();
    if (!emailToAppIds.has(email)) emailToAppIds.set(email, []);
    const chapter = a.chapters as unknown as Record<string, unknown>;
    emailToAppIds.get(email)!.push({
      appId: a.id as string,
      chapterId: a.chapter_id as string,
      chapterName: chapter.name as string,
      status: a.status as string,
    });
  }

  // Build team_id+chapter_id -> has submissions lookup for no-show detection
  const teamChapterSubmissions = new Set<string>();
  if (allSubmissions && allRegistrations) {
    // Map challenge_id -> chapter registrations to find which teams submitted
    const challengeToChapterTeams = new Map<string, { chapterId: string; teamId: string }[]>();
    for (const reg of allRegistrations) {
      const cid = reg.challenge_id as string;
      if (!challengeToChapterTeams.has(cid)) challengeToChapterTeams.set(cid, []);
      challengeToChapterTeams.get(cid)!.push({
        chapterId: reg.chapter_id as string,
        teamId: reg.team_id as string,
      });
    }
    for (const sub of allSubmissions) {
      const teamId = sub.team_id as string;
      const challengeId = sub.challenge_id as string;
      const regs = challengeToChapterTeams.get(challengeId);
      if (regs) {
        for (const reg of regs) {
          if (reg.teamId === teamId) {
            teamChapterSubmissions.add(`${teamId}:${reg.chapterId}`);
          }
        }
      }
    }
  }

  // ─── Enrich applications ───────────────────────────────────

  const enriched = applications.map((app) => {
    const teamInfo = emailToTeam.get(app.email.toLowerCase());
    const appScores = scoresByApp.get(app.id) ?? [];
    const avgScore =
      appScores.length > 0
        ? Math.round((appScores.reduce((sum, s) => sum + s.score, 0) / appScores.length) * 10) / 10
        : null;

    // Previous screening scores from other chapters
    const otherApps = (emailToAppIds.get(app.email.toLowerCase()) ?? []).filter(
      (a) => a.chapterId !== id
    );
    const previousScores: { chapterName: string; averageScore: number }[] = [];
    for (const other of otherApps) {
      const otherScores = scoresByApp.get(other.appId);
      if (otherScores && otherScores.length > 0) {
        const avg = Math.round(
          (otherScores.reduce((sum, s) => sum + s.score, 0) / otherScores.length) * 10
        ) / 10;
        previousScores.push({ chapterName: other.chapterName, averageScore: avg });
      }
    }

    // Past participations (checked_in at other chapters)
    const pastParticipations = otherApps.filter((a) => a.status === "checked_in").length;

    // No-shows: checked_in but team had no submission
    let noShows = 0;
    if (teamInfo) {
      for (const other of otherApps) {
        if (other.status === "checked_in") {
          const key = `${teamInfo.teamId}:${other.chapterId}`;
          if (!teamChapterSubmissions.has(key)) {
            noShows++;
          }
        }
      }
    }

    // TUM.ai verification
    const selfReported = app.formData?.isTumaiMember ?? false;
    const inList = tumaiEmails.has(app.email.toLowerCase());

    // Fuzzy name match when email not found but claims membership
    let fuzzyMatch: { name: string; score: number } | null = null;
    if (selfReported && !inList) {
      const fullName = [app.firstName, app.lastName].filter(Boolean).join(" ");
      if (fullName.trim()) {
        fuzzyMatch = findBestNameMatch(fullName, tumaiNames);
      }
    }

    // Flag matching: check email, LinkedIn, GitHub, name
    const matchedFlagIds = new Set<string>();
    const flags: { id: string; reason: string; screenshotUrl: string | null; createdByName: string; createdAt: string; matchedVia: string }[] = [];

    const addFlags = (source: string, entries: FlagEntry[] | undefined) => {
      for (const entry of entries ?? []) {
        if (!matchedFlagIds.has(entry.id)) {
          matchedFlagIds.add(entry.id);
          flags.push({ ...entry, matchedVia: source });
        }
      }
    };

    addFlags("email", flagsByEmail.get(app.email.toLowerCase()));
    const appLinkedin = extractLinkedInUsername(app.formData?.linkedIn);
    if (appLinkedin) addFlags("linkedin", flagsByLinkedin.get(appLinkedin));
    const appGithub = extractGitHubUsername(app.formData?.github);
    if (appGithub) addFlags("github", flagsByGithub.get(appGithub));
    const appName = normalizeName(app.firstName, app.lastName);
    if (appName) addFlags("name", flagsByName.get(appName));

    return {
      ...app,
      screening: {
        isLeagueMember: !!teamInfo,
        teamId: teamInfo?.teamId ?? null,
        teamName: teamInfo?.teamName ?? null,
        totalPoints: teamInfo?.totalPoints ?? 0,
        scores: appScores,
        averageScore: avgScore,
        previousScores,
        pastParticipations,
        noShows,
        flags,
        tumaiVerification: {
          selfReported,
          verified: selfReported && (inList || (fuzzyMatch !== null && fuzzyMatch.score === 1)),
          mismatch: selfReported && !inList && !fuzzyMatch,
          fuzzyMatch: fuzzyMatch && fuzzyMatch.score < 1 ? {
            matchedName: fuzzyMatch.name,
            score: Math.round(fuzzyMatch.score * 100),
          } : null,
        },
      },
    };
  });

  if (screeningTruncated) {
    console.warn(
      `[screening] Enrichment queries hit their row cap for chapter ${id}; ` +
        "screening averages may be computed from partial data. Raise LIMIT_SCREENING_SCORES / LIMIT_APPLICATION_STATS."
    );
  }

  // Expose truncation via a header so the screening UI can warn without a
  // body-shape change (the body stays a plain array for existing consumers).
  return NextResponse.json(enriched, {
    headers: { "X-Screening-Truncated": screeningTruncated ? "1" : "0" },
  });
}
