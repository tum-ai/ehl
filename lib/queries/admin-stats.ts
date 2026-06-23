import { createAdminClient } from "@/lib/supabase/admin";
import { QUERY_LIMITS } from "@/lib/config/limits";

// ─── Types ────────────────────────────────────────────────

export interface ChapterStats {
  chapterId: string;
  chapterName: string;
  matchNumber: number;
  status: string;
  applied: number;
  accepted: number;
  checkedIn: number;
  registrations: number;
  submissions: number;
}

export interface SeasonStats {
  totalParticipants: number;
  totalSubmissions: number;
  totalRegistrations: number;
  applicationFunnel: {
    applied: number;
    accepted: number;
    checkedIn: number;
    submitted: number;
  };
  seasonProgression: {
    completed: number;
    total: number;
  };
  perChapter: ChapterStats[];
}

export interface ChapterDetailStats {
  applications: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    waitlisted: number;
    checkedIn: number;
    cancelled: number;
  };
  challenges: Array<{
    challengeId: string;
    title: string;
    sponsorName: string | null;
    registrations: number;
    submissions: number;
    juryAssigned: number;
    juryVoted: number;
  }>;
  totals: {
    registeredTeams: number;
    submittedTeams: number;
    checkedInParticipants: number;
  };
}

// ─── Season-level stats ───────────────────────────────────

export async function getSeasonStats(): Promise<SeasonStats> {
  const adminClient = createAdminClient();

  // Get all chapters
  const { data: chapters } = await adminClient
    .from("chapters")
    .select("id, name, match_number, status")
    .order("match_number");

  const allChapters = chapters ?? [];
  const completedCount = allChapters.filter((c) => c.status === "completed").length;

  // Get all applications grouped by chapter
  const { data: applications } = await adminClient
    .from("applications")
    .select("chapter_id, status")
    .limit(QUERY_LIMITS.adminStatsApplications);

  const allApps = applications ?? [];

  // Count unique checked-in participants (by email would require another query,
  // so we count unique chapter+status combos as a proxy)
  const totalApplied = allApps.length;
  const totalAccepted = allApps.filter(
    (a) => a.status === "accepted" || a.status === "checked_in"
  ).length;
  const totalCheckedIn = allApps.filter(
    (a) => a.status === "checked_in"
  ).length;

  // Get all challenge registrations
  const { data: registrations } = await adminClient
    .from("challenge_registrations")
    .select("chapter_id, team_id")
    .limit(QUERY_LIMITS.challengeRegistrations);

  const allRegs = registrations ?? [];

  // Get all submissions
  const { data: submissions } = await adminClient
    .from("submissions")
    .select("challenge_id, team_id")
    .limit(QUERY_LIMITS.adminStatsApplications);

  const allSubs = submissions ?? [];

  // Build per-chapter stats
  const perChapter: ChapterStats[] = allChapters.map((ch) => {
    const chapterApps = allApps.filter((a) => a.chapter_id === ch.id);
    const chapterRegs = allRegs.filter((r) => r.chapter_id === ch.id);

    return {
      chapterId: ch.id as string,
      chapterName: ch.name as string,
      matchNumber: ch.match_number as number,
      status: ch.status as string,
      applied: chapterApps.length,
      accepted: chapterApps.filter(
        (a) => a.status === "accepted" || a.status === "checked_in"
      ).length,
      checkedIn: chapterApps.filter((a) => a.status === "checked_in").length,
      registrations: chapterRegs.length,
      submissions: 0, // filled below
    };
  });

  // Get submission counts per chapter (need to go through challenge -> chapter mapping)
  const { data: challengeChapters } = await adminClient
    .from("challenges")
    .select("id, chapter_id")
    .limit(QUERY_LIMITS.adminStatsApplications);

  const challengeToChapter = new Map<string, string>();
  for (const cc of challengeChapters ?? []) {
    challengeToChapter.set(cc.id as string, cc.chapter_id as string);
  }

  for (const sub of allSubs) {
    const chapterId = challengeToChapter.get(sub.challenge_id as string);
    if (chapterId) {
      const ch = perChapter.find((c) => c.chapterId === chapterId);
      if (ch) ch.submissions++;
    }
  }

  // Count unique teams that submitted
  const uniqueSubmittedTeams = new Set(allSubs.map((s) => s.team_id as string));

  return {
    totalParticipants: totalCheckedIn,
    totalSubmissions: allSubs.length,
    totalRegistrations: allRegs.length,
    applicationFunnel: {
      applied: totalApplied,
      accepted: totalAccepted,
      checkedIn: totalCheckedIn,
      submitted: uniqueSubmittedTeams.size,
    },
    seasonProgression: {
      completed: completedCount,
      total: allChapters.length,
    },
    perChapter,
  };
}

// ─── Per-chapter detail stats ─────────────────────────────

export async function getChapterDetailStats(
  chapterId: string
): Promise<ChapterDetailStats> {
  const adminClient = createAdminClient();

  // Application stats
  const { data: apps } = await adminClient
    .from("applications")
    .select("status")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.applicationsPerChapter);

  const allApps = apps ?? [];
  const applicationStats = {
    total: allApps.length,
    pending: allApps.filter((a) => a.status === "pending").length,
    accepted: allApps.filter((a) => a.status === "accepted").length,
    rejected: allApps.filter((a) => a.status === "rejected").length,
    waitlisted: allApps.filter((a) => a.status === "waitlisted").length,
    checkedIn: allApps.filter((a) => a.status === "checked_in").length,
    cancelled: allApps.filter((a) => a.status === "cancelled").length,
  };

  // Challenges for this chapter
  const { data: challenges } = await adminClient
    .from("challenges")
    .select("id, title, sponsor_name")
    .eq("chapter_id", chapterId);

  const allChallenges = challenges ?? [];

  // Challenge registrations
  const { data: regs } = await adminClient
    .from("challenge_registrations")
    .select("challenge_id, team_id")
    .eq("chapter_id", chapterId)
    .limit(QUERY_LIMITS.challengeRegistrations);

  const allRegs = regs ?? [];

  // Submissions per challenge
  const challengeIds = allChallenges.map((c) => c.id as string);
  let allSubs: Array<Record<string, unknown>> = [];
  if (challengeIds.length > 0) {
    const { data: subs } = await adminClient
      .from("submissions")
      .select("challenge_id, team_id")
      .in("challenge_id", challengeIds)
      .limit(QUERY_LIMITS.submissionsPerChallenge);
    allSubs = subs ?? [];
  }

  // Jury assignments and rankings per challenge
  let allAssignments: Array<Record<string, unknown>> = [];
  let allRankings: Array<Record<string, unknown>> = [];
  if (challengeIds.length > 0) {
    const [assignRes, rankRes] = await Promise.all([
      adminClient
        .from("jury_assignments")
        .select("challenge_id, user_id")
        .in("challenge_id", challengeIds),
      adminClient
        .from("jury_rankings")
        .select("challenge_id, entered_by")
        .in("challenge_id", challengeIds),
    ]);
    allAssignments = assignRes.data ?? [];
    allRankings = rankRes.data ?? [];
  }

  const challengeStats = allChallenges.map((ch) => {
    const cId = ch.id as string;
    return {
      challengeId: cId,
      title: ch.title as string,
      sponsorName: (ch.sponsor_name as string) ?? null,
      registrations: allRegs.filter((r) => r.challenge_id === cId).length,
      submissions: allSubs.filter((s) => s.challenge_id === cId).length,
      juryAssigned: new Set(
        allAssignments
          .filter((a) => a.challenge_id === cId)
          .map((a) => a.user_id as string)
      ).size,
      juryVoted: new Set(
        allRankings
          .filter((r) => r.challenge_id === cId)
          .map((r) => r.entered_by as string)
      ).size,
    };
  });

  return {
    applications: applicationStats,
    challenges: challengeStats,
    totals: {
      registeredTeams: allRegs.length,
      submittedTeams: allSubs.length,
      checkedInParticipants: applicationStats.checkedIn,
    },
  };
}
