"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LimitBanner } from "@/components/admin/limit-banner";
import { DeleteTeamButton } from "./delete-team-button";
import { DeleteParticipantButton } from "./delete-participant-button";
import { RemoveMemberButton } from "./remove-member-button";
import { TeamAdminControls } from "./team-admin-controls";
import { TeamChallengeControl } from "./team-challenge-control";
import { ChangeEmailButton } from "./change-email-button";
import { filterTeams, filterParticipants } from "./team-search";
import { memberLabel, successorLabel } from "./removal-consequence";
import type { Team, TeamMember, Profile, Chapter } from "@/lib/types";
import type { ParticipantWithTeam } from "@/lib/queries/teams";

type View = "teams" | "participants";

interface ChallengeOption {
  id: string;
  title: string;
}

interface Props {
  teams: Team[];
  allMembers: (TeamMember & { profile?: Profile })[];
  participants: ParticipantWithTeam[];
  activeChapter: Chapter | null;
  challengeOverrideOpen: boolean;
  challenges: ChallengeOption[];
  registrationsByTeam: [string, string][];
  teamsTruncated: boolean;
  membersTruncated: boolean;
  participantsTruncated: boolean;
}

export function TeamsAndParticipantsView({
  teams,
  allMembers,
  participants,
  activeChapter,
  challengeOverrideOpen,
  challenges,
  registrationsByTeam,
  teamsTruncated,
  membersTruncated,
  participantsTruncated,
}: Props) {
  const [view, setView] = useState<View>("teams");
  const [search, setSearch] = useState("");

  const registrationMap = new Map<string, string>(registrationsByTeam);

  const membersByTeam = new Map<string, (TeamMember & { profile?: Profile })[]>();
  for (const member of allMembers) {
    const existing = membersByTeam.get(member.teamId) ?? [];
    existing.push(member);
    membersByTeam.set(member.teamId, existing);
  }

  // One search box serves both tabs. Teams match on member name/email too: an
  // operator on an event day is almost always holding a person, not a team.
  const filteredParticipants = filterParticipants(participants, search);
  const filteredTeams = filterTeams(teams, membersByTeam, search);
  const visibleCount = view === "teams" ? filteredTeams.length : filteredParticipants.length;
  const totalCount = view === "teams" ? teams.length : participants.length;

  // Group participants by team for check-in summary
  const teamCheckinMap = new Map<string, { total: number; checkedIn: number }>();
  for (const p of participants) {
    if (p.teamId) {
      const existing = teamCheckinMap.get(p.teamId) ?? { total: 0, checkedIn: 0 };
      existing.total++;
      if (p.checkedIn) existing.checkedIn++;
      teamCheckinMap.set(p.teamId, existing);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Teams</h1>
          <p className="mt-1 ad-text-secondary">
            {teams.length} teams, {participants.length} participants
          </p>
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border ad-border overflow-hidden">
          <button
            onClick={() => setView("teams")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              view === "teams"
                ? "bg-purple-600 text-white"
                : "ad-bg-card ad-text-secondary hover:ad-bg-card-hover"
            }`}
          >
            Teams
          </button>
          <button
            onClick={() => setView("participants")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              view === "participants"
                ? "bg-purple-600 text-white"
                : "ad-bg-card ad-text-secondary hover:ad-bg-card-hover"
            }`}
          >
            Participants
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <LimitBanner truncated={teamsTruncated} count={teams.length} label="teams" />
        <LimitBanner
          truncated={membersTruncated}
          count={allMembers.length}
          label="team members"
        />
        <LimitBanner
          truncated={participantsTruncated}
          count={participants.length}
          label="participants"
        />
      </div>

      <div className="mt-6 flex items-center gap-4">
        <input
          type="text"
          placeholder={
            view === "teams"
              ? "Search teams by name, university, city, or member..."
              : "Search by name, email, or team..."
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-lg border ad-border bg-white px-4 py-2 text-sm ad-text placeholder:ad-text-muted focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <span className="whitespace-nowrap text-sm ad-text-muted">
          {search ? `${visibleCount} of ${totalCount}` : `${totalCount} total`}
        </span>
      </div>

      {view === "teams" ? (
        <TeamsTable
          teams={filteredTeams}
          membersByTeam={membersByTeam}
          teamCheckinMap={teamCheckinMap}
          activeChapter={activeChapter}
          challengeOverrideOpen={challengeOverrideOpen}
          challenges={challenges}
          registrationMap={registrationMap}
          allTeams={teams}
          searchActive={!!search.trim()}
        />
      ) : (
        <ParticipantsTable
          participants={filteredParticipants}
          activeChapter={activeChapter}
          searchActive={!!search.trim()}
        />
      )}
    </div>
  );
}

function TeamsTable({
  teams,
  membersByTeam,
  teamCheckinMap,
  activeChapter,
  challengeOverrideOpen,
  challenges,
  registrationMap,
  allTeams,
  searchActive,
}: {
  teams: Team[];
  membersByTeam: Map<string, (TeamMember & { profile?: Profile })[]>;
  teamCheckinMap: Map<string, { total: number; checkedIn: number }>;
  activeChapter: Chapter | null;
  challengeOverrideOpen: boolean;
  challenges: ChallengeOption[];
  registrationMap: Map<string, string>;
  /** Every team, not just the filtered rows: the move-member target list must
   *  stay complete or a search would silently shrink where a member can go. */
  allTeams: Team[];
  searchActive: boolean;
}) {
  const showChallenge = challengeOverrideOpen && !!activeChapter;
  // Team, Members, University, Status, Actions, plus Check-In and Challenge
  // when those columns are shown.
  const columnCount = 5 + (activeChapter ? 1 : 0) + (showChallenge ? 1 : 0);
  return (
    <div className="mt-8 overflow-x-auto rounded-2xl ad-border ad-bg-card ui-card-subtle">
      <table className="w-full">
        <thead>
          <tr className="border-b ad-border text-left text-xs font-bold uppercase tracking-wider ad-text-muted">
            <th className="px-6 py-4">Team</th>
            <th className="px-6 py-4">Members</th>
            {activeChapter && <th className="px-6 py-4 text-center">Check-In</th>}
            {showChallenge && <th className="px-6 py-4">Challenge</th>}
            <th className="px-6 py-4">University</th>
            <th className="px-6 py-4 text-center">Status</th>
            <th className="px-6 py-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {teams.length === 0 && (
            <tr>
              <td colSpan={columnCount} className="px-6 py-10 text-center text-sm ad-text-muted">
                {searchActive ? "No teams match that search." : "No teams yet."}
              </td>
            </tr>
          )}
          {teams.map((team) => {
            const members = membersByTeam.get(team.id) ?? [];
            const checkin = teamCheckinMap.get(team.id);
            const allCheckedIn = checkin ? checkin.checkedIn === checkin.total : false;
            return (
              <tr
                key={team.id}
                className="border-b ad-border ad-bg-card-hover transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/team/${team.slug}`}
                    className="font-semibold ad-text hover:text-purple-700 transition-colors"
                  >
                    {team.name}
                  </Link>
                </td>
                <td className="px-6 py-4">
                  {members.length > 0 ? (
                    <div className="space-y-0.5">
                      {members.map((m) => (
                        <p key={m.userId} className="flex items-center gap-1.5 whitespace-nowrap text-sm ad-text-secondary">
                          <span>{memberLabel(m)}</span>
                          {m.role === "president" && (
                            <span className="text-[10px] font-bold uppercase ad-text-gold">
                              Capt
                            </span>
                          )}
                          {/* Every member is removable, captain included. The
                              consequence (promotion, dropping below the minimum,
                              emptying the team) is named in the confirm step. */}
                          <RemoveMemberButton
                            teamId={team.id}
                            userId={m.userId}
                            memberName={memberLabel(m)}
                            teamName={team.name}
                            rosterSize={members.length}
                            isCaptain={m.role === "president"}
                            successorName={successorLabel(members, m.userId)}
                          />
                        </p>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm ad-text-muted">No members</span>
                  )}
                </td>
                {activeChapter && (
                  <td className="px-6 py-4 text-center">
                    {checkin ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          allCheckedIn
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {allCheckedIn ? "All In" : `${checkin.checkedIn}/${checkin.total}`}
                      </span>
                    ) : (
                      <span className="text-sm ad-text-muted">-</span>
                    )}
                  </td>
                )}
                {showChallenge && (
                  <td className="px-6 py-4">
                    <TeamChallengeControl
                      teamId={team.id}
                      chapterId={activeChapter!.id}
                      currentChallengeId={registrationMap.get(team.id) ?? null}
                      challenges={challenges}
                    />
                  </td>
                )}
                <td className="px-6 py-4 text-sm ad-text-muted">
                  {team.university || "-"}
                </td>
                <td className="px-6 py-4 text-center">
                  <Badge variant="completed" light>Active</Badge>
                </td>
                <td className="px-6 py-4 text-right align-top">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/team/${team.slug}`}
                      className="text-sm font-medium ad-text-link transition-colors"
                    >
                      View
                    </Link>
                    <TeamAdminControls
                      teamId={team.id}
                      members={members.map((m) => ({
                        userId: m.userId,
                        role: m.role,
                        name: m.profile?.name || m.profile?.email || m.userId.slice(0, 8),
                      }))}
                      allTeams={allTeams.map((t) => ({ id: t.id, name: t.name }))}
                    />
                    <DeleteTeamButton teamId={team.id} teamName={team.name} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ParticipantsTable({
  participants,
  activeChapter,
  searchActive,
}: {
  participants: ParticipantWithTeam[];
  activeChapter: Chapter | null;
  searchActive: boolean;
}) {
  // Name, Email, Team, Role, Actions, plus Check-In when a chapter is running.
  const columnCount = 5 + (activeChapter ? 1 : 0);
  return (
    <div className="mt-4">
      <div className="overflow-x-auto rounded-2xl ad-border ad-bg-card ui-card-subtle">
        <table className="w-full">
          <thead>
            <tr className="border-b ad-border text-left text-xs font-bold uppercase tracking-wider ad-text-muted">
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Email</th>
              <th className="px-6 py-4">Team</th>
              <th className="px-6 py-4">Role</th>
              {activeChapter && <th className="px-6 py-4 text-center">Check-In</th>}
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {participants.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-6 py-10 text-center text-sm ad-text-muted">
                  {searchActive ? "No participants match that search." : "No participants yet."}
                </td>
              </tr>
            )}
            {participants.map((p) => (
              <tr
                key={p.id}
                className="border-b ad-border ad-bg-card-hover transition-colors"
              >
                <td className="px-6 py-4 text-sm font-medium ad-text">
                  {p.name || "-"}
                </td>
                <td className="px-6 py-4 text-sm ad-text-secondary">
                  <span className="inline-flex items-center gap-2">
                    {p.email}
                    <ChangeEmailButton userId={p.id} currentEmail={p.email} />
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  {p.teamSlug ? (
                    <Link
                      href={`/team/${p.teamSlug}`}
                      className="font-medium ad-text-link hover:underline"
                    >
                      {p.teamName}
                    </Link>
                  ) : (
                    <span className="ad-text-muted">-</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  {p.teamRole === "president" ? (
                    <span className="text-xs font-bold uppercase ad-text-gold">Captain</span>
                  ) : p.teamRole === "member" ? (
                    <span className="text-xs ad-text-muted">Member</span>
                  ) : (
                    <span className="ad-text-muted">-</span>
                  )}
                </td>
                {activeChapter && (
                  <td className="px-6 py-4 text-center">
                    {p.checkedIn ? (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span className="text-xs font-medium">Checked In</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-400">
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        <span className="text-xs font-medium">Not In</span>
                      </span>
                    )}
                  </td>
                )}
                <td className="px-6 py-4 text-right">
                  <DeleteParticipantButton
                    userId={p.id}
                    name={p.name || ""}
                    email={p.email}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
