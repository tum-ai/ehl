"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { getEventStatus, getChapterEventInfo } from "@/lib/actions/event";
import { TeamSelector } from "./team-selector";
import { ChallengeSelector } from "./challenge-selector";
import { JoinRequestManager } from "./join-request-manager";

interface EventHubProps {
  chapterId: string;
  chapterName: string;
  chapterSlug: string;
}

interface TeamMemberStatus {
  userId: string;
  name: string;
  role: string;
  checkedIn: boolean;
}

interface EventState {
  userId: string;
  checkedIn: boolean;
  team: { id: string; name: string; isPresident: boolean } | null;
  challengeRegistration: {
    id: string;
    challengeId: string;
    challengeTitle: string;
    teamId: string;
    roster: string[];
    registeredAt: string;
  } | null;
  challengeRegistrationEnabled: boolean;
  pendingJoinRequests: Array<{
    id: string;
    teamId: string;
    teamName: string;
    status: string;
  }>;
  incomingJoinRequests: Array<{
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    status: string;
  }>;
}

export function EventHub({ chapterId, chapterName, chapterSlug }: EventHubProps) {
  const [state, setState] = useState<EventState | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberStatus[]>([]);
  const [eventInfo, setEventInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Event info is gated server-side: getChapterEventInfo returns null unless the
  // viewer is an attending applicant of this chapter, so the panel only renders
  // for the intended audience and never exposes the text more broadly.
  useEffect(() => {
    getChapterEventInfo(chapterId).then(setEventInfo).catch(() => {});
  }, [chapterId]);

  const loadState = useCallback(async () => {
    const result = await getEventStatus(chapterId);
    if (result.error) {
      setError(result.error);
    } else {
      const eventState = result as unknown as EventState;
      setState(eventState);

      // Load team member check-in status when team exists
      if (eventState.team) {
        try {
          const memberRes = await fetch(
            `/api/teams/${eventState.team.id}/members?chapterId=${chapterId}`
          );
          const members = await memberRes.json();
          if (Array.isArray(members)) {
            setTeamMembers(members);
          }
        } catch {
          // Non-critical, team status card just won't show
        }
      }
    }
    setLoading(false);
  }, [chapterId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Admin-authored event info (Discord link, schedule, venue). `eventInfo` is
  // non-null only for attending applicants (accepted/checked_in), enforced by
  // getChapterEventInfo server-side, so rendering it above every state branch is
  // safe: a non-applicant or non-attending viewer simply gets null and no panel.
  // This lets accepted-but-not-yet-checked-in participants see it even though the
  // rest of the hub stays gated behind check-in.
  const eventInfoPanel = eventInfo && eventInfo.trim().length > 0 ? (
    <Card className="mb-8">
      <h2 className="text-lg font-bold text-gold">Event info</h2>
      <p className="mt-2 whitespace-pre-line text-sm text-text-secondary">
        {eventInfo}
      </p>
    </Card>
  ) : null;

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        {eventInfoPanel}
        <div className="text-center py-16">
          <p className="text-text-secondary">Loading event...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        {eventInfoPanel}
        <div className="text-center py-16">
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="mt-2 text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!state) return eventInfoPanel;

  const teamDone = !!state.team;
  const challengeDone = !!state.challengeRegistration;
  const checkedInCount = teamMembers.filter((m) => m.checkedIn).length;
  const allCheckedIn = teamMembers.length > 0 && checkedInCount === teamMembers.length;

  return (
    <div className="mx-auto max-w-3xl">
      {eventInfoPanel}
      <div className="mb-8">
        <h1 className="text-3xl font-black">
          <span className="text-gold">{chapterName}</span>
        </h1>
        <p className="mt-2 text-text-secondary">
          Welcome to the event hub. Complete the steps below to get started.
        </p>
      </div>

      {/* Progress indicator */}
      <div className="mb-8 flex items-center gap-4">
        <StepIndicator step={1} label="Check-in" done />
        <div className="h-px flex-1 bg-white/10" />
        <StepIndicator step={2} label="Team" done={teamDone} />
        <div className="h-px flex-1 bg-white/10" />
        <StepIndicator step={3} label="Challenge" done={challengeDone} />
      </div>

      {/* Step 1: Check-in (always done if they're here) */}
      <Card className="mb-6 border-green-500/20">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
            <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-bold">Checked In</p>
            <p className="text-sm text-text-secondary">You are checked in for this event.</p>
          </div>
        </div>
      </Card>

      {/* Step 2: Team selection */}
      <Card className={`mb-6 ${teamDone ? "border-green-500/20" : "border-gold/20"}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${teamDone ? "bg-green-500/10" : "bg-gold/10"}`}>
            {teamDone ? (
              <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <span className="text-sm font-bold text-gold">2</span>
            )}
          </div>
          <div>
            <p className="font-bold">
              {teamDone
                ? `Team: ${state.team!.name} ${state.team!.isPresident ? "(President)" : "(Member)"}`
                : "Choose Your Team"}
            </p>
            {!teamDone && (
              <p className="text-sm text-text-secondary">
                Continue with your existing team, join another team, or create a new one.
              </p>
            )}
          </div>
        </div>

        {!teamDone && (
          <TeamSelector
            chapterId={chapterId}
            userId={state.userId}
            pendingRequests={state.pendingJoinRequests}
            onTeamSelected={loadState}
          />
        )}
      </Card>

      {/* Team check-in status (always visible when team exists) */}
      {teamDone && teamMembers.length > 0 && (
        <Card className={`mb-6 ${allCheckedIn ? "border-green-500/20" : "border-yellow-500/20"}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${allCheckedIn ? "bg-green-500/10" : "bg-yellow-500/10"}`}>
              {allCheckedIn ? (
                <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
              )}
            </div>
            <div>
              <p className="font-bold">
                Team Check-in: {checkedInCount} of {teamMembers.length}
              </p>
              {!allCheckedIn && (
                <p className="text-sm text-yellow-400">
                  All members must check in before submitting.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            {teamMembers.map((m) => (
              <div key={m.userId} className="flex items-center gap-2 text-sm">
                {m.checkedIn ? (
                  <svg className="h-4 w-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span className={m.checkedIn ? "text-text-primary" : "text-text-muted"}>
                  {m.name}
                </span>
                {m.role === "president" && (
                  <span className="text-xs text-gold">(President)</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Incoming join requests (for presidents) */}
      {state.team?.isPresident && state.incomingJoinRequests.length > 0 && (
        <Card className="mb-6 border-purple/20">
          <JoinRequestManager
            requests={state.incomingJoinRequests}
            onResolved={loadState}
          />
        </Card>
      )}

      {/* Step 3: Challenge selection (president only, when enabled) */}
      {teamDone && (
        <Card className={`mb-6 ${challengeDone ? "border-green-500/20" : "border-gold/20"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${challengeDone ? "bg-green-500/10" : "bg-gold/10"}`}>
              {challengeDone ? (
                <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="text-sm font-bold text-gold">3</span>
              )}
            </div>
            <div>
              <p className="font-bold">
                {challengeDone
                  ? `Challenge: ${state.challengeRegistration!.challengeTitle}`
                  : "Select a Challenge"}
              </p>
              {challengeDone && (
                <p className="text-sm text-text-secondary">
                  Roster: {state.challengeRegistration!.roster.length} members
                </p>
              )}
            </div>
          </div>

          {!challengeDone && (
            <>
              {!state.team!.isPresident ? (
                <p className="text-sm text-text-secondary">
                  Only the team president can select a challenge. Ask your president to register.
                </p>
              ) : !state.challengeRegistrationEnabled ? (
                <p className="text-sm text-text-secondary">
                  Challenge registration is not open yet. The organizers will enable it soon.
                </p>
              ) : teamMembers.length < 2 ? (
                <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
                  <p className="text-sm font-medium text-gold">Your team needs more members</p>
                  <p className="mt-1 text-sm text-text-secondary">
                    You need at least 2 team members to register for a challenge. Invite someone from your dashboard or accept join requests.
                  </p>
                </div>
              ) : (
                <ChallengeSelector
                  chapterId={chapterId}
                  teamId={state.team!.id}
                  userId={state.userId}
                  onRegistered={loadState}
                />
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function StepIndicator({
  step,
  label,
  done,
}: {
  step: number;
  label: string;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
          done
            ? "bg-green-500/20 text-green-400"
            : "bg-white/5 text-text-muted"
        }`}
      >
        {done ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          step
        )}
      </div>
      <span className={`text-sm ${done ? "text-green-400" : "text-text-muted"}`}>{label}</span>
    </div>
  );
}
