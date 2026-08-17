"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toggleLookingForTeam, acceptTeamInvite, declineTeamInvite, requestToJoinTeam, createTeam } from "@/lib/actions/teams";
import type { TeamInvite, TeamJoinRequest } from "@/lib/types";
import type { TeamLookingForMembers } from "@/lib/queries";

interface TeamlessViewProps {
  lookingForTeam: boolean;
  pendingInvites: TeamInvite[];
  teamsLookingForMembers: TeamLookingForMembers[];
  upcomingEventRecruiting: {
    chapterName: string;
    chapterHref: string;
    chapterCity: string;
    chapterDate: string;
    teams: TeamLookingForMembers[];
  } | null;
  pendingJoinRequests: TeamJoinRequest[];
}

interface RecruitingTeamCardsProps {
  teams: TeamLookingForMembers[];
  requestedTeamIds: ReadonlySet<string>;
  actionLoading: string | null;
  onRequestJoin: (teamId: string) => void;
}

function RecruitingTeamCards({
  teams,
  requestedTeamIds,
  actionLoading,
  onRequestJoin,
}: RecruitingTeamCardsProps) {
  return (
    <div className="space-y-2">
      {teams.map((team) => {
        const alreadyRequested = requestedTeamIds.has(team.id);
        return (
          <Card key={team.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gold">{team.name}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {[team.university, team.city].filter(Boolean).join(", ") || "No origin set"}
                  {" "}&middot; {team.memberCount}/5 members
                </p>
                {team.memberNames.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {team.memberNames.map((name, index) => (
                      <span
                        key={`${team.id}-${index}`}
                        className="inline-flex items-center rounded-full bg-surface-deep px-2.5 py-0.5 text-xs text-text-secondary"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0">
                {alreadyRequested ? (
                  <Badge variant="announced">Requested</Badge>
                ) : (
                  <button
                    onClick={() => onRequestJoin(team.id)}
                    disabled={actionLoading === team.id}
                    className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
                  >
                    {actionLoading === team.id ? "Sending..." : "Ask to Join"}
                  </button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function TeamlessView({
  lookingForTeam: initialLooking,
  pendingInvites: initialInvites,
  teamsLookingForMembers,
  upcomingEventRecruiting,
  pendingJoinRequests: initialJoinRequests,
}: TeamlessViewProps) {
  const router = useRouter();
  const [lookingForTeam, setLookingForTeam] = useState(initialLooking);
  const [invites, setInvites] = useState(initialInvites);
  const [joinRequests, setJoinRequests] = useState(initialJoinRequests);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Track which teams the user has already requested to join
  const requestedTeamIds = new Set(joinRequests.map((r) => r.teamId));

  async function handleToggleLooking() {
    const newValue = !lookingForTeam;
    const result = await toggleLookingForTeam(newValue);
    if (!result.error) {
      setLookingForTeam(newValue);
    }
  }

  async function handleAccept(token: string, inviteId: string) {
    setActionLoading(inviteId);
    const result = await acceptTeamInvite(token);
    setActionLoading(null);
    if (result.error) {
      alert(result.error);
    } else {
      router.refresh();
    }
  }

  async function handleDecline(token: string, inviteId: string) {
    setActionLoading(inviteId);
    const result = await declineTeamInvite(token);
    setActionLoading(null);
    if (result.error) {
      alert(result.error);
    } else {
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    }
  }

  async function handleRequestJoin(teamId: string) {
    setActionLoading(teamId);
    const result = await requestToJoinTeam(teamId);
    setActionLoading(null);
    if (result.error) {
      alert(result.error);
    } else {
      // Optimistic: add to local set
      setJoinRequests((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          teamId,
          userId: "",
          chapterId: "",
          status: "pending" as const,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          resolvedBy: null,
        },
      ]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      <Card>
        <div className="py-4 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple/10">
              <svg className="h-7 w-7 text-purple-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
          </div>
          <p className="text-lg font-bold">You are not part of a team yet</p>
          <p className="mt-1 text-sm text-text-muted">
            Join an existing team or create your own
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {showCreateForm ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setCreating(true);
                  setCreateError(null);
                  const formData = new FormData(e.currentTarget);
                  const result = await createTeam(
                    formData.get("teamName") as string,
                    (formData.get("university") as string) || undefined,
                    (formData.get("city") as string) || undefined,
                  );
                  setCreating(false);
                  if (result.error) {
                    setCreateError(result.error);
                  } else {
                    window.location.reload();
                  }
                }}
                className="w-full space-y-3 rounded-xl border border-white/10 bg-surface-card p-4 text-left"
              >
                <h3 className="font-bold text-text-primary">Create Your Team</h3>
                {createError && <p className="text-sm text-error">{createError}</p>}
                <input
                  name="teamName"
                  required
                  placeholder="Team Name *"
                  className="w-full rounded-lg border border-white/10 bg-surface-deep px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    name="university"
                    placeholder="University"
                    className="rounded-lg border border-white/10 bg-surface-deep px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                  />
                  <input
                    name="city"
                    placeholder="City"
                    className="rounded-lg border border-white/10 bg-surface-deep px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-surface-deep hover:bg-gold/90 disabled:opacity-50"
                  >
                    {creating ? "Creating..." : "Create Team"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setCreateError(null);
                    }}
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm text-text-muted hover:text-text-primary"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <Button onClick={() => setShowCreateForm(true)}>
                Create a Team
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Looking for team toggle */}
      <Card>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={lookingForTeam}
            onChange={handleToggleLooking}
            className="h-4 w-4 rounded border-white/20 bg-surface-deep"
          />
          <div>
            <p className="text-sm font-medium">Looking for a team</p>
            <p className="text-xs text-text-muted">
              Other participants and team presidents can see that you are looking for a team
            </p>
          </div>
        </label>
      </Card>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
            Team Invites
          </h2>
          <div className="space-y-2">
            {invites.map((invite) => (
              <Card key={invite.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {invite.teamName || "Team"}
                    </p>
                    <p className="text-xs text-text-muted">
                      Invited to join as a member
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDecline(invite.token, invite.id)}
                      disabled={actionLoading === invite.id}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAccept(invite.token, invite.id)}
                      disabled={actionLoading === invite.id}
                    >
                      {actionLoading === invite.id ? "..." : "Accept"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {upcomingEventRecruiting && (
        <section data-testid="upcoming-event-recruiting">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
            Teams Recruiting for {upcomingEventRecruiting.chapterName}
          </h2>
          <p className="mb-3 mt-1 text-xs text-text-muted">
            {upcomingEventRecruiting.chapterCity} &middot; {upcomingEventRecruiting.chapterDate}
            {" "}&middot;{" "}
            <Link href={upcomingEventRecruiting.chapterHref} className="text-gold hover:underline">
              Event details
            </Link>
          </p>
          {upcomingEventRecruiting.teams.length > 0 ? (
            <RecruitingTeamCards
              teams={upcomingEventRecruiting.teams}
              requestedTeamIds={requestedTeamIds}
              actionLoading={actionLoading}
              onRequestJoin={handleRequestJoin}
            />
          ) : (
            <Card>
              <p className="text-sm text-text-muted">
                No teams are currently recruiting for this event.
              </p>
            </Card>
          )}
        </section>
      )}

      {/* Teams looking for members */}
      {teamsLookingForMembers.length > 0 && (
        <section data-testid="general-recruiting">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
            Teams Looking for Members
          </h2>
          <RecruitingTeamCards
            teams={teamsLookingForMembers}
            requestedTeamIds={requestedTeamIds}
            actionLoading={actionLoading}
            onRequestJoin={handleRequestJoin}
          />
        </section>
      )}
    </div>
  );
}
