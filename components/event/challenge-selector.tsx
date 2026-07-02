"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { registerChallenge } from "@/lib/actions/event";

interface Challenge {
  id: string;
  title: string;
  description: string | null;
  sponsorName: string | null;
}

interface TeamMemberInfo {
  userId: string;
  name: string;
  role: string;
  checkedIn: boolean;
}

interface ChallengeSelectorProps {
  chapterId: string;
  teamId: string;
  userId: string;
  onRegistered: () => void;
}

export function ChallengeSelector({
  chapterId,
  teamId,
  userId,
  onRegistered,
}: ChallengeSelectorProps) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberInfo[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(null);
  const [roster, setRoster] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [challengeRes, memberRes] = await Promise.all([
        fetch(`/api/chapters/${chapterId}/challenges`).then((r) => r.json()).catch(() => []),
        fetch(`/api/teams/${teamId}/members?chapterId=${chapterId}`).then((r) => r.json()).catch(() => []),
      ]);
      // Error responses ({error: ...}, e.g. 429 behind a shared venue IP)
      // parse as JSON too — guard so we never crash or hang on "Loading...".
      const challengeList = Array.isArray(challengeRes) ? (challengeRes as Challenge[]) : [];
      const memberList = Array.isArray(memberRes) ? (memberRes as TeamMemberInfo[]) : [];
      if (!Array.isArray(challengeRes) || !Array.isArray(memberRes)) {
        setError(
          (challengeRes as { error?: string })?.error ??
            (memberRes as { error?: string })?.error ??
            "Failed to load challenges. Please reload the page."
        );
      }
      setChallenges(challengeList);
      setTeamMembers(memberList);

      // Auto-include only checked-in members in roster (president always included)
      const checkedInIds = new Set<string>(
        memberList
          .filter((m) => m.checkedIn)
          .map((m) => m.userId)
      );
      // Always include the president
      checkedInIds.add(userId);
      setRoster(checkedInIds);
      setLoading(false);
    }
    load();
  }, [chapterId, teamId, userId]);

  function toggleRoster(memberId: string) {
    // President cannot be removed, non-checked-in members cannot be added
    if (memberId === userId) return;
    const member = teamMembers.find((m) => m.userId === memberId);
    if (member && !member.checkedIn) return;

    setRoster((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const hasUncheckedMembers = teamMembers.some((m) => !m.checkedIn);
  const rosterHasUnchecked = Array.from(roster).some((id) => {
    const member = teamMembers.find((m) => m.userId === id);
    return member && !member.checkedIn;
  });

  async function handleRegister() {
    if (!selectedChallenge) return;
    if (roster.size < 2 || roster.size > 5) {
      setError("Roster must have 2 to 5 members.");
      return;
    }

    setActing(true);
    setError(null);

    const result = await registerChallenge(
      chapterId,
      selectedChallenge,
      teamId,
      Array.from(roster)
    );

    if (result.error) {
      setError(result.error);
    } else {
      onRegistered();
    }
    setActing(false);
  }

  if (loading) {
    return <p className="text-sm text-text-secondary">Loading challenges...</p>;
  }

  if (challenges.length === 0) {
    // A load error must win over the empty state — with a failed fetch the
    // list is empty too, and "No challenges available yet." would hide it.
    if (error) {
      return (
        <div className="rounded-lg border border-error/20 bg-error/5 p-3">
          <p className="text-sm text-error">{error}</p>
        </div>
      );
    }
    return <p className="text-sm text-text-secondary">No challenges available yet.</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-error/20 bg-error/5 p-3">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* Challenge selection */}
      <div>
        <p className="text-sm text-text-muted mb-2">Select a challenge for your team:</p>
        <div className="space-y-2">
          {challenges.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedChallenge(c.id)}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                selectedChallenge === c.id
                  ? "border-gold/40 bg-gold/5"
                  : "border-white/10 hover:border-white/20"
              }`}
            >
              <p className="font-bold">{c.title}</p>
              {c.sponsorName && (
                <p className="mt-0.5 text-sm text-text-muted">by {c.sponsorName}</p>
              )}
              {c.description && (
                <p className="mt-1 text-sm text-text-secondary line-clamp-2">{c.description}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Roster selection */}
      {selectedChallenge && (
        <div>
          <p className="text-sm text-text-muted mb-2">
            Select roster (2-5 members). The president is always included.
          </p>

          {hasUncheckedMembers && (
            <div className="mb-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
              <p className="text-sm text-yellow-400">
                Some team members are not checked in yet. Only checked-in members can be added to the roster.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {teamMembers.map((m) => {
              const isPresident = m.userId === userId;
              const isSelected = roster.has(m.userId);
              const isDisabled = isPresident || !m.checkedIn;
              return (
                <label
                  key={m.userId}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    !m.checkedIn
                      ? "border-white/5 bg-white/[0.01] opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "border-gold/40 bg-gold/5 cursor-pointer"
                        : "border-white/10 hover:border-white/20 cursor-pointer"
                  } ${isPresident ? "cursor-default" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRoster(m.userId)}
                    disabled={isDisabled}
                    className="rounded accent-gold"
                  />
                  <div className="flex items-center gap-2">
                    {/* Check-in status icon */}
                    {m.checkedIn ? (
                      <svg className="h-4 w-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span className="font-medium">{m.name}</span>
                    {isPresident && (
                      <span className="text-xs text-gold">(President, required)</span>
                    )}
                    {!m.checkedIn && (
                      <span className="text-xs text-red-400">(Not checked in)</span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {roster.size} of 2-5 members selected
          </p>
        </div>
      )}

      {selectedChallenge && (
        <Button
          onClick={handleRegister}
          disabled={acting || !selectedChallenge || roster.size < 2 || roster.size > 5 || rosterHasUnchecked}
        >
          {acting ? "Registering..." : "Register for Challenge"}
        </Button>
      )}
    </div>
  );
}
