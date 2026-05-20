import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/actions/auth";
import {
  getTeamForUser,
  getChapters,
  getUnlocksForTeam,
  getLeaderboard,
  getTeamMembersWithProfiles,
  getPendingInvitesForTeam,
  getTeamsLookingForMembers,
  getDashboardJoinRequestsForTeam,
  getPendingJoinRequestsForUser,
  getUsersLookingForTeam,
  getPublishedScoresForTeam,
  getTeamMatchHistory,
} from "@/lib/queries";
import { redirect } from "next/navigation";
import { formatDateRange } from "@/lib/utils";
import { TeamManagement } from "@/components/dashboard/team-management";
import { TeamlessView } from "@/components/dashboard/teamless-view";
import { createClient } from "@/lib/supabase/server";

export default async function ParticipantDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const userId = session.user.id;
  const membership = await getTeamForUser(userId);

  // ─── Teamless view ────────────────────────────────────
  if (!membership) {
    // Get pending invites for this user's email
    const supabase = await createClient();
    const { data: inviteRows } = await supabase
      .from("team_invites")
      .select("*, teams!inner(name)")
      .eq("email", session.profile?.email ?? "")
      .eq("status", "pending");

    const pendingInvites = (inviteRows ?? []).map((row) => {
      const team = row.teams as unknown as Record<string, unknown>;
      return {
        id: row.id as string,
        teamId: row.team_id as string,
        email: row.email as string,
        name: (row.name as string) ?? null,
        invitedBy: row.invited_by as string,
        status: row.status as "pending",
        token: row.token as string,
        createdAt: row.created_at as string,
        expiresAt: row.expires_at as string,
        teamName: team.name as string,
      };
    });

    const [teamsLookingForMembers, pendingJoinRequests] = await Promise.all([
      getTeamsLookingForMembers(),
      getPendingJoinRequestsForUser(userId),
    ]);

    return (
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-text-secondary">
          Welcome, {session.profile?.name || "Participant"}
        </p>
        <div className="mt-8">
          <TeamlessView
            lookingForTeam={session.profile?.lookingForTeam ?? false}
            pendingInvites={pendingInvites}
            teamsLookingForMembers={teamsLookingForMembers}
            pendingJoinRequests={pendingJoinRequests}
          />
        </div>
      </div>
    );
  }

  // ─── Has a team (president or member) ──────────────────
  const { team, role } = membership;
  const isPresident = role === "president";

  const [chapters, unlocks, leaderboard, members, publishedScores, matchHistory] = await Promise.all([
    getChapters(),
    getUnlocksForTeam(team.id),
    getLeaderboard(),
    getTeamMembersWithProfiles(team.id),
    getPublishedScoresForTeam(team.id),
    getTeamMatchHistory(team.id),
  ]);

  const teamEntry = leaderboard.find((e) => e.team.id === team.id);
  const unlockedChapterIds = new Set(unlocks.map((u) => u.chapterId));
  const scoredChapterIds = new Set(publishedScores.map((s) => s.chapterId));

  // Get captain-specific data
  let pendingInvites: Awaited<ReturnType<typeof getPendingInvitesForTeam>> = [];
  let joinRequests: Awaited<ReturnType<typeof getDashboardJoinRequestsForTeam>> = [];
  let lookingForTeamUsers: Awaited<ReturnType<typeof getUsersLookingForTeam>> = [];

  if (isPresident) {
    [pendingInvites, joinRequests, lookingForTeamUsers] = await Promise.all([
      getPendingInvitesForTeam(team.id),
      getDashboardJoinRequestsForTeam(team.id),
      getUsersLookingForTeam(),
    ]);

    // Filter out users who are already team members or have pending invites
    const memberEmails = new Set(members.map((m) => m.profile?.email?.toLowerCase()).filter(Boolean));
    const inviteEmails = new Set(pendingInvites.map((i) => i.email.toLowerCase()));
    lookingForTeamUsers = lookingForTeamUsers.filter(
      (u) => u.email && !memberEmails.has(u.email.toLowerCase()) && !inviteEmails.has(u.email.toLowerCase()) && u.id !== userId
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Team Dashboard</h1>
      <p className="mt-1 text-text-secondary">
        Welcome, {session.profile?.name || (isPresident ? "President" : "Member")}
      </p>

      {/* Team info + stats */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-text-muted">Team</p>
          <p className="mt-1 text-lg font-bold text-gold">{team.name}</p>
          <p className="text-xs text-text-muted">{team.university || team.city || "No origin set"}</p>
        </Card>
        <Card>
          <p className="text-sm text-text-muted">Rank</p>
          <p className="mt-1 text-3xl font-mono font-bold text-gold">
            {teamEntry ? `#${teamEntry.rank}` : "-"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-text-muted">Points</p>
          <p className="mt-1 text-3xl font-mono font-bold text-gold">
            {teamEntry?.totalPoints ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-text-muted">Members</p>
          <p className="mt-1 text-3xl font-mono font-bold text-gold">
            {members.length}
          </p>
        </Card>
      </div>

      {/* Team Management (captain only) */}
      {isPresident && (
        <div className="mt-8">
          <TeamManagement
            team={team}
            members={members}
            pendingInvites={pendingInvites}
            joinRequests={joinRequests}
            lookingForTeamUsers={lookingForTeamUsers}
            currentUserId={userId}
          />
        </div>
      )}

      {/* Member roster (read-only for members) */}
      {!isPresident && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
            Team Roster
          </h2>
          <Card>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between rounded-lg border border-white/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {m.profile?.name || m.profile?.email || "Unknown"}
                      {m.userId === userId && <span className="ml-1.5 text-gold">*</span>}
                    </p>
                    <p className="text-xs text-text-muted">{m.profile?.email}</p>
                  </div>
                  <Badge variant={m.role === "president" ? "completed" : "upcoming"}>
                    {m.role === "president" ? "President" : "Member"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Matches */}
      <div className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
          Matches
        </h2>
        <div className="mt-4 space-y-2">
          {chapters
            .filter((c) => c.status !== "draft")
            .map((chapter) => {
              const isUnlocked = unlockedChapterIds.has(chapter.id);
              const isCompleted = chapter.status === "completed";
              const hasParticipated = matchHistory.some((m) => m.chapter.id === chapter.id);
              const hasCertificate = isCompleted && scoredChapterIds.has(chapter.id);

              // Status label + badge variant
              const statusConfig: Record<string, { label: string; variant: "completed" | "announced" | "live" | "upcoming" | "default" }> = {
                announced: { label: "Announced", variant: "upcoming" },
                applications_open: { label: "Applications Open", variant: "announced" },
                preparation: { label: "Preparation", variant: "announced" },
                challenge_selection: { label: "Challenge Selection", variant: "live" },
                hacking: { label: "Hacking", variant: "live" },
                submissions_open: { label: "Submissions Open", variant: "live" },
                pitching: { label: "Pitching", variant: "live" },
                completed: { label: hasParticipated ? "Completed" : "Not Participated", variant: hasParticipated ? "completed" : "default" },
              };

              const { label: statusLabel, variant: statusVariant } = statusConfig[chapter.status] ?? { label: chapter.status, variant: "upcoming" as const };

              return (
                <div key={chapter.id} className="rounded-lg border border-white/5 transition-colors hover:bg-surface-card/50">
                  <Link href={`/matches/${chapter.slug}`}>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple/10 font-mono text-xs font-bold text-purple">
                          {chapter.matchNumber}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{chapter.name}</p>
                          <p className="text-xs text-text-muted">
                            {chapter.city} &middot; {formatDateRange(chapter.date, chapter.dateEnd)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isUnlocked && !isCompleted && (
                          <Badge variant="announced">Unlocked</Badge>
                        )}
                        <Badge variant={statusVariant}>{statusLabel}</Badge>
                      </div>
                    </div>
                  </Link>
                  {hasCertificate && (
                    <div className="border-t border-white/5 px-4 py-2">
                      <a
                        href={`/api/certificates/${chapter.id}/${team.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gold hover:underline"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Download Certificate (PDF)
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Match Participation History */}
      {matchHistory.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
            Your Participation
          </h2>
          <div className="mt-4 space-y-3">
            {matchHistory.map((entry) => (
              <Card key={`${entry.chapter.id}-${entry.challenge?.id}`} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/matches/${entry.chapter.slug}`} className="font-medium hover:text-gold transition-colors">
                      {entry.chapter.name}
                    </Link>
                    <p className="text-xs text-text-muted mt-0.5">
                      {entry.chapter.city}{entry.chapter.date ? ` \u00b7 ${new Date(entry.chapter.date).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  {entry.score && (
                    <div className="text-right">
                      {entry.score.placement && (
                        <p className="font-mono text-lg font-bold text-gold">#{entry.score.placement}</p>
                      )}
                      <p className="text-xs text-text-muted">{entry.score.points} pts</p>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {entry.challenge && (
                    <span className="rounded-full bg-purple/10 px-2 py-0.5 text-purple">
                      {entry.challenge.title}
                    </span>
                  )}
                  {entry.submission ? (
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-green-400">
                      Submitted: {entry.submission.projectName}
                    </span>
                  ) : entry.chapter.status === "completed" ? (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-400">
                      No submission
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">
                      Pending submission
                    </span>
                  )}
                  {entry.registration && (
                    <span className="rounded-full bg-surface-card px-2 py-0.5 text-text-muted">
                      Roster: {entry.registration.roster.length} members
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Team link */}
      <div className="mt-8">
        <Link
          href={`/team/${team.slug}`}
          className="text-sm text-gold hover:underline"
        >
          View public team profile
        </Link>
      </div>
    </div>
  );
}
