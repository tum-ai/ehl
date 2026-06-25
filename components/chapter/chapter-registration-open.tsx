"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateFull, formatDeadline } from "@/lib/utils";
import { registerForChallenge } from "@/lib/actions/submissions";
import { DeadlineCountdown } from "@/components/submission/deadline-countdown";
import { MIN_CHALLENGE_ROSTER } from "@/lib/config/limits";
import type { Chapter, Challenge } from "@/lib/types";

interface CheckinInfo {
  total: number;
  checkedIn: number;
  allCheckedIn: boolean;
  members: { name: string; checkedIn: boolean }[];
}

/**
 * Message shown in the "no checked-in team" panel during challenge selection.
 * Distinguishes a logged-in participant without a team (must join/create one)
 * from a logged-out visitor (must log in). `userRole` truthy means the user is
 * already on a team and the team-check-in branch handles the messaging instead.
 */
export function noTeamRegistrationMessage(
  userRole: "president" | "member" | null,
  isLoggedIn: boolean,
): string {
  if (userRole) {
    return "Your team needs to check in to participate. Check in at the event to get started.";
  }
  if (isLoggedIn) {
    return "You're not on a team yet. Join an existing team or create one, then check in at the event. A team needs at least two members to register for a challenge.";
  }
  return "Log in to see your team status and register for a challenge.";
}

interface ChapterRegistrationOpenProps {
  chapter: Chapter;
  challenges: Challenge[];
  checkinInfo: CheckinInfo | null;
  registeredChallengeId: string | null;
  userRole: "president" | "member" | null;
  teamId: string | null;
  isLoggedIn: boolean;
}

export function ChapterRegistrationOpen({
  chapter,
  challenges,
  checkinInfo,
  registeredChallengeId: initialRegisteredId,
  userRole,
  teamId,
  isLoggedIn,
}: ChapterRegistrationOpenProps) {
  const [registeredChallengeId, setRegisteredChallengeId] = useState(initialRegisteredId);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A team must have at least MIN_CHALLENGE_ROSTER members to register for a
  // challenge (mirrors the server guard in registerForChallenge). A solo team
  // cannot select a challenge even if its one member is checked in.
  const teamTooSmall = checkinInfo !== null && checkinInfo.total < MIN_CHALLENGE_ROSTER;
  const canRegister = checkinInfo?.allCheckedIn && userRole === "president" && !teamTooSmall;

  async function handleRegister(challengeId: string) {
    if (!teamId) return;
    setLoading(challengeId);
    setError(null);

    // The roster is derived server-side from the team's actual members.
    const result = await registerForChallenge(chapter.id, challengeId, teamId);

    setLoading(null);
    if (result.error) {
      setError(result.error);
    } else {
      setRegisteredChallengeId(challengeId);
    }
  }

  return (
    <div className="relative">
      <div className="glow-blob glow-blob-purple absolute -right-60 -top-40 h-[500px] w-[500px] opacity-10" />

      <div className="relative">
        <Badge variant="announced">Challenge Selection</Badge>
        <h1 className="mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
          {chapter.name}
        </h1>
        <p className="mt-3 text-text-secondary">
          {chapter.city}, {chapter.country} &middot; {formatDateFull(chapter.date, chapter.dateEnd)}
        </p>
        {chapter.description && (
          <p className="mt-4 max-w-2xl font-hero-body leading-relaxed text-text-secondary">
            {chapter.description}
          </p>
        )}
      </div>

      {/* Challenge selection deadline */}
      {chapter.challengeSelectionDeadline && (
        <DeadlineCountdown
          deadline={chapter.challengeSelectionDeadline}
          label="Challenge Selection Deadline"
          expiredMessage="Challenge selection has closed."
        />
      )}

      {/* Team check-in status */}
      {teamTooSmall ? (
        <div className="mt-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.03] p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/10">
              <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-yellow-400">
                Team too small: {checkinInfo?.total} of {MIN_CHALLENGE_ROSTER} members
              </p>
              <p className="text-sm text-text-secondary">
                {userRole === "president"
                  ? `Your team needs at least ${MIN_CHALLENGE_ROSTER} members to register for a challenge. Invite teammates before challenge selection closes.`
                  : `Your team needs at least ${MIN_CHALLENGE_ROSTER} members before it can register for a challenge.`}
              </p>
            </div>
          </div>
        </div>
      ) : checkinInfo && checkinInfo.allCheckedIn ? (
        <div className="mt-8 rounded-2xl border border-gold/20 bg-gold/[0.03] p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10">
              <svg className="h-5 w-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-gold">All members checked in!</p>
              <p className="text-sm text-text-secondary">
                {userRole === "president"
                  ? (registeredChallengeId
                    ? "Your team is registered. You can switch challenges until selection closes."
                    : "Choose a challenge below to register your team.")
                  : (registeredChallengeId
                    ? "Your team president has selected a challenge."
                    : "Your team president will select a challenge for your team.")}
              </p>
            </div>
          </div>
        </div>
      ) : checkinInfo && checkinInfo.total > 0 ? (
        <div className="mt-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.03] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/10">
              <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-yellow-400">
                Team Check-in: {checkinInfo.checkedIn} of {checkinInfo.total}
              </p>
              <p className="text-sm text-text-secondary">
                All members must check in before your team can register for a challenge.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {checkinInfo.members.map((m) => (
              <div key={m.name} className="flex items-center gap-2 text-sm">
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
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6">
          <p className="text-text-muted">
            {noTeamRegistrationMessage(userRole, isLoggedIn)}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Challenges */}
      <div className="mt-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
            Challenges
          </h2>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-purple/30" />
        </div>

        <div className="space-y-6">
          {challenges.map((challenge) => {
            const isRegistered = registeredChallengeId === challenge.id;
            const isOtherRegistered = registeredChallengeId !== null && !isRegistered;
            const isLoading = loading === challenge.id;

            return (
              <div
                key={challenge.id}
                className={`overflow-hidden rounded-2xl border transition-all ${isRegistered ? "border-gold/30 bg-gold/[0.02]" : "border-white/[0.06] bg-surface-card/60"}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-6 pb-0">
                  <div className="flex items-start gap-4">
                    {challenge.sponsorLogoUrl && (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2">
                        <img
                          src={challenge.sponsorLogoUrl}
                          alt={challenge.sponsorName || ""}
                          className="h-full w-auto object-contain"
                        />
                      </div>
                    )}
                    <div>
                      <h3 className="font-hero-heading text-xl font-bold">{challenge.title}</h3>
                      {challenge.sponsorName && (
                        <p className="mt-0.5 text-sm text-text-muted">by {challenge.sponsorName}</p>
                      )}
                    </div>
                  </div>
                  {isRegistered && (
                    <Badge variant="completed">Your Challenge</Badge>
                  )}
                </div>

                {/* Description */}
                {challenge.description && (
                  <div className="px-6 pt-4">
                    <p className="whitespace-pre-line font-hero-body leading-relaxed text-text-secondary">
                      {challenge.description}
                    </p>
                  </div>
                )}

                {/* Info grid */}
                {(challenge.judgingCriteria || challenge.prizeDescription) && (
                  <div className="mt-4 grid gap-px border-t border-white/[0.06] sm:grid-cols-2">
                    {challenge.judgingCriteria && (
                      <div className="border-b border-white/[0.06] p-6 sm:border-b-0 sm:border-r">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-purple-light/70">
                          Judging Criteria
                        </p>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{challenge.judgingCriteria}</p>
                      </div>
                    )}
                    {challenge.prizeDescription && (
                      <div className="p-6">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-gold/70">
                          Prize
                        </p>
                        <p className="whitespace-pre-line text-sm font-medium text-gold">{challenge.prizeDescription}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Submission requirements */}
                {challenge.submissionFields.length > 0 && (
                  <div className="border-t border-white/[0.06] p-6">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
                      Submission Requirements
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {challenge.submissionFields.map((field) => (
                        <span
                          key={field.key}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${field.required ? "border-purple/20 bg-purple/5 text-purple-light" : "border-white/10 bg-white/[0.03] text-text-secondary"}`}
                        >
                          {field.label}
                          {field.required && (
                            <span className="h-1 w-1 rounded-full bg-gold" />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Challenge Brief PDF */}
                {challenge.briefFileId && (
                  <div className="border-t border-white/[0.06] p-6">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
                      Challenge Brief
                    </p>
                    <div className="overflow-hidden rounded-xl border border-white/10" style={{ height: "500px" }}>
                      <iframe
                        src={`/api/challenges/${challenge.id}/brief`}
                        className="h-full w-full"
                      />
                    </div>
                  </div>
                )}

                {/* Register / Switch / Status */}
                {canRegister && (
                  <div className="border-t border-white/[0.06] p-6">
                    {isRegistered ? (
                      <p className="text-sm text-text-secondary">
                        Your team is registered for this challenge. You can switch to a different challenge until selection closes.
                      </p>
                    ) : (
                      <button
                        onClick={() => handleRegister(challenge.id)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-2 rounded-xl bg-gold px-6 py-3 text-sm font-bold text-surface-deep transition-all hover:brightness-110 disabled:opacity-50"
                      >
                        {isLoading ? (
                          "Registering..."
                        ) : isOtherRegistered ? (
                          <>
                            Switch to this Challenge
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                            </svg>
                          </>
                        ) : (
                          <>
                            Register for this Challenge
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
