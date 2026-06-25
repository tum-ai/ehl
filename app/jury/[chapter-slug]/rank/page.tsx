"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PLACEMENT_POINTS } from "@/lib/scoring";
import { submitJuryRanking, skipJuryVote } from "@/lib/actions/jury";

interface Team {
  id: string;
  name: string;
}

interface Submission {
  teamId: string;
  projectName: string;
  shortDescription: string | null;
  fields: Record<string, string>;
  forkUrl: string | null;
}

export default function JuryRankingPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params["chapter-slug"] as string;
  // The challenge the juror is voting on. Required to disambiguate when the
  // juror is assigned to more than one challenge in the same chapter.
  const challengeParam = searchParams.get("challenge");
  // Suffix used to carry the challenge back to the chapter page on navigation.
  const backQuery = challengeParam ? `?challenge=${challengeParam}` : "";

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [ranking, setRanking] = useState<(string | null)[]>([null, null, null, null, null]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [hasExistingVote, setHasExistingVote] = useState(false);
  const [finalized, setFinalized] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const assignmentRes = await fetch(
          `/api/jury/assignment?slug=${slug}${
            challengeParam ? `&challengeId=${challengeParam}` : ""
          }`
        );
        if (!assignmentRes.ok) {
          setError("Could not load assignment.");
          setLoading(false);
          return;
        }
        const assignment = await assignmentRes.json();
        setChallengeId(assignment.challengeId);

        const [teamsRes, subsRes, rankingRes] = await Promise.all([
          fetch("/api/teams").then((r) => r.json()),
          fetch(`/api/jury/submissions?challengeId=${assignment.challengeId}`).then((r) => r.json()),
          fetch(`/api/jury/ranking?challengeId=${assignment.challengeId}`).then((r) => r.json()),
        ]);

        setTeams(teamsRes);
        setSubmissions(subsRes);

        if (rankingRes?.ranking) {
          setHasExistingVote(true);
          const restored: (string | null)[] = [null, null, null, null, null];
          for (const [place, teamId] of Object.entries(rankingRes.ranking)) {
            const idx = parseInt(place) - 1;
            if (idx >= 0 && idx < 5) restored[idx] = teamId as string;
          }
          setRanking(restored);
        }
      } catch {
        setError("Failed to load data.");
      }
      setLoading(false);
    }
    load();
  }, [slug, challengeParam]);

  function getTeamName(teamId: string): string {
    return teams.find((t) => t.id === teamId)?.name || "Unknown";
  }

  function getSub(teamId: string): Submission | undefined {
    return submissions.find((s) => s.teamId === teamId);
  }

  // Teams with submissions
  const eligibleTeams = teams.filter((t) =>
    submissions.some((s) => s.teamId === t.id)
  );

  const maxSlots = Math.min(5, eligibleTeams.length);
  const assignedTeamIds = new Set(ranking.filter(Boolean));
  const availableTeams = eligibleTeams.filter((t) => !assignedTeamIds.has(t.id));
  const filledSlots = ranking.filter(Boolean).length;

  function addTeam(teamId: string) {
    setRanking((prev) => {
      const next = [...prev];
      const firstEmpty = next.findIndex((v, i) => !v && i < maxSlots);
      if (firstEmpty >= 0) next[firstEmpty] = teamId;
      return next;
    });
  }

  function removeFromSlot(index: number) {
    setRanking((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setRanking((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    if (index >= maxSlots - 1) return;
    setRanking((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  async function handleSubmit() {
    if (!challengeId) return;
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.set("challengeId", challengeId);

    const rankingData: Record<string, string> = {};
    ranking.forEach((teamId, i) => {
      if (teamId) rankingData[(i + 1).toString()] = teamId;
    });
    formData.set("ranking", JSON.stringify(rankingData));
    formData.set("feedback", JSON.stringify(feedback));

    const result = await submitJuryRanking(formData);

    if (result.error) {
      if (result.error.includes("finalized")) setFinalized(true);
      setError(result.error);
      setSubmitting(false);
      setShowConfirm(false);
    } else {
      router.push(`/jury/${slug}${backQuery}`);
    }
  }

  async function handleSkip() {
    if (!challengeId) return;
    if (!confirm("Skip voting for this challenge? You can still come back and vote later, as long as voting has not been finalized.")) return;

    setSkipping(true);
    const result = await skipJuryVote(challengeId);

    if (result.error) {
      setError(result.error);
      setSkipping(false);
    } else {
      router.push(`/jury/${slug}${backQuery}`);
    }
  }

  if (loading) {
    return (
      <div>
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  if (finalized) {
    return (
      <div>
        <Link
          href={`/jury/${slug}${backQuery}`}
          className="text-sm text-text-muted hover:text-text-secondary transition-colors"
        >
          &larr; Back to Challenge
        </Link>
        <div className="mt-6">
          <h1 className="text-2xl font-bold">Voting Finalized</h1>
          <p className="mt-2 text-text-secondary">
            Voting for this challenge has been finalized by the admin. No further changes can be made.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href={`/jury/${slug}${backQuery}`}
        className="text-sm text-text-muted hover:text-text-secondary transition-colors"
      >
        &larr; Back to Challenge
      </Link>

      <div className="mt-6">
        <h1 className="text-2xl font-bold">
          {hasExistingVote ? "Update Your Ranking" : "Enter Your Ranking"}
        </h1>
        <p className="mt-2 text-text-secondary">
          Tap teams below to place them in your top {maxSlots}. Tap a placed team to remove it.
          {hasExistingVote && " You can update your ranking until voting is finalized."}
        </p>
      </div>

      {/* Ranking slots */}
      <div className="mt-8 space-y-2">
        {Array.from({ length: maxSlots }).map((_, i) => {
          const place = i + 1;
          const teamId = ranking[i];
          const points = PLACEMENT_POINTS[place] ?? 0;
          const sub = teamId ? getSub(teamId) : undefined;

          return (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                teamId
                  ? "border-gold/20 bg-gold/[0.03]"
                  : "border-white/[0.06] border-dashed bg-white/[0.02]"
              }`}
            >
              {/* Place number */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/10 font-mono text-sm font-bold text-gold">
                {place}
              </span>

              {/* Team info or empty */}
              <div className="flex-1 min-w-0">
                {teamId ? (
                  <div>
                    <p className="font-bold truncate">{getTeamName(teamId)}</p>
                    {sub?.projectName && (
                      <p className="text-sm text-text-muted truncate">{sub.projectName}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    {filledSlots === i ? "Select a team below" : ""}
                  </p>
                )}
              </div>

              {/* Points */}
              <span className="shrink-0 font-mono text-sm text-gold">+{points}</span>

              {/* Actions */}
              {teamId && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="rounded p-1 text-text-muted hover:bg-white/5 hover:text-text-secondary transition-colors disabled:opacity-20 disabled:hover:bg-transparent"
                    title="Move up"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i >= maxSlots - 1 || !ranking[i + 1]}
                    className="rounded p-1 text-text-muted hover:bg-white/5 hover:text-text-secondary transition-colors disabled:opacity-20 disabled:hover:bg-transparent"
                    title="Move down"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => removeFromSlot(i)}
                    className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    title="Remove"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Available teams */}
      {availableTeams.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Available Teams ({availableTeams.length})
          </h2>
          <div className="mt-3 space-y-2">
            {availableTeams.map((team) => {
              const sub = getSub(team.id);
              const isFull = filledSlots >= maxSlots;

              return (
                <button
                  key={team.id}
                  onClick={() => addTeam(team.id)}
                  disabled={isFull}
                  className={`w-full rounded-xl border border-white/[0.06] px-4 py-3 text-left transition-all ${
                    isFull
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:border-purple/30 hover:bg-purple/[0.03] cursor-pointer"
                  }`}
                >
                  <p className="font-bold">{team.name}</p>
                  {sub?.projectName && (
                    <p className="text-sm text-text-muted">{sub.projectName}</p>
                  )}
                  {sub?.shortDescription && (
                    <p className="mt-1 text-xs text-text-muted/70 line-clamp-2">{sub.shortDescription}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Feedback section */}
      {filledSlots > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Feedback (optional)
          </h2>
          <div className="mt-3 space-y-3">
            {ranking.map((teamId, i) => {
              if (!teamId) return null;
              return (
                <div key={teamId}>
                  <label className="text-sm text-text-muted">
                    #{i + 1} {getTeamName(teamId)}
                  </label>
                  <textarea
                    placeholder="Optional feedback (max 500 chars)"
                    maxLength={500}
                    value={feedback[teamId] || ""}
                    onChange={(e) =>
                      setFeedback((prev) => ({
                        ...prev,
                        [teamId]: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-purple focus:outline-none resize-none"
                    rows={2}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{error}</p>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="mx-4 max-w-md">
            <h2 className="text-lg font-bold">
              {hasExistingVote ? "Update Your Vote" : "Submit Your Vote"}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              {hasExistingVote
                ? "This will update your previous vote. You can change it again until voting is finalized."
                : "You can update your vote later if needed, until the admin finalizes voting."}
            </p>

            <div className="mt-4 space-y-2">
              {ranking.map((teamId, i) => {
                if (!teamId) return null;
                const place = i + 1;
                return (
                  <div
                    key={place}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      #{place} {getTeamName(teamId)}
                    </span>
                    <span className="font-mono text-gold">
                      +{PLACEMENT_POINTS[place] ?? 0}
                    </span>
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="mt-3 text-sm text-error">{error}</p>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowConfirm(false);
                  setError(null);
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting..." : hasExistingVote ? "Update Vote" : "Submit Vote"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Submit + Skip buttons */}
      {!showConfirm && (
        <div className="mt-8 flex gap-3">
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={filledSlots < maxSlots}
            className="flex-1"
            size="lg"
          >
            {filledSlots < maxSlots
              ? `Select ${maxSlots - filledSlots} more team${maxSlots - filledSlots > 1 ? "s" : ""}`
              : hasExistingVote
                ? "Update Vote"
                : "Submit Vote"}
          </Button>
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={skipping}
            size="lg"
          >
            {skipping ? "Skipping..." : "Skip"}
          </Button>
        </div>
      )}
    </div>
  );
}
