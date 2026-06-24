"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLACEMENT_POINTS, PARTICIPATION_POINTS } from "@/lib/scoring";
import { publishScores, sendCertificateEmails } from "@/lib/actions/admin";
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes";

interface Team {
  id: string;
  name: string;
}

interface Challenge {
  id: string;
  title: string;
  sponsorName: string | null;
}

interface JuryVote {
  jurorId: string;
  jurorName: string;
  ranking: Record<string, string>;
  submittedAt: string;
  isFinal: boolean;
}

interface ChallengeJuryData {
  rankings: JuryVote[];
  aggregated: Record<string, number>;
}

interface Score {
  teamId: string;
  challengeId: string | null;
  challengeName: string;
  placement: number | null;
  points: number;
  source: string;
}

interface ChapterInfo {
  id: string;
  name: string;
  status: string;
}

interface ScoreOverride {
  teamId: string;
  placement: number | null;
  points: number;
}

export default function AdminScoresPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [chapterId, setChapterId] = useState("");
  const [chapter, setChapter] = useState<ChapterInfo | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [juryData, setJuryData] = useState<Record<string, ChallengeJuryData>>({});
  const [scores, setScores] = useState<Score[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ScoreOverride>>({});
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [sendingCerts, setSendingCerts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Score overrides are staged in local state until "Save Override(s)" is
  // clicked; warn before navigating away with unsaved overrides.
  useUnsavedChanges(Object.keys(overrides).length > 0);

  useEffect(() => {
    params.then(async ({ id }) => {
      setChapterId(id);

      const [teamsRes, challengesRes, chapterRes] = await Promise.all([
        fetch("/api/admin/teams").then((r) => r.json()),
        fetch(`/api/admin/chapters/${id}/challenges`).then((r) => r.json()),
        fetch(`/api/admin/chapters/${id}/details`).then((r) => r.json()).catch(() => null),
      ]);

      setTeams(teamsRes);
      setChallenges(challengesRes);
      if (chapterRes) {
        setChapter(chapterRes);
      }

      // Load all jury rankings (admin endpoint, returns all jurors)
      const juryDataRes = await fetch(`/api/admin/chapters/${id}/jury-rankings`)
        .then((r) => r.json())
        .catch(() => ({}));
      setJuryData(juryDataRes);

      // Load existing scores
      const scoresRes = await fetch(`/api/admin/chapters/${id}/scores`)
        .then((r) => r.json())
        .catch(() => []);
      setScores(scoresRes);

      setLoading(false);
    });
  }, [params]);

  function getTeamName(teamId: string): string {
    return teams.find((t) => t.id === teamId)?.name || "Unknown";
  }

  function getScoreForTeam(teamId: string): Score | undefined {
    return scores.find((s) => s.teamId === teamId);
  }

  function handleOverride(teamId: string, placement: string) {
    const placeNum = placement === "" ? null : parseInt(placement);
    const points = placeNum ? (PLACEMENT_POINTS[placeNum] ?? 0) : PARTICIPATION_POINTS;

    setOverrides((prev) => ({
      ...prev,
      [teamId]: { teamId, placement: placeNum, points },
    }));
  }

  async function handleSaveOverrides() {
    if (Object.keys(overrides).length === 0) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/scores/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId,
          overrides: Object.values(overrides),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSuccess("Overrides saved.");
        setOverrides({});
        // Reload scores
        const scoresRes = await fetch(`/api/admin/chapters/${chapterId}/scores`)
          .then((r) => r.json())
          .catch(() => []);
        setScores(scoresRes);
      }
    } catch {
      setError("Failed to save overrides.");
    }
    setSaving(false);
  }

  async function handlePublish() {
    // Publishing is what advances a chapter to "completed". It must always be
    // reachable, even with no scores (e.g. a chapter with no jury-scored
    // challenge, or where finalization produced none) — otherwise the chapter can
    // never be completed. But completing with no scores means an empty
    // leaderboard, so make that an explicit, louder confirmation.
    const message =
      scores.length === 0
        ? "This chapter has NO scores yet. Publishing will mark it as completed with an empty leaderboard. If you expected scores, finalize the jury rankings first. Continue anyway?"
        : "Publish scores and mark this chapter as completed? This will make results visible on the public leaderboard.";
    if (!confirm(message)) {
      return;
    }
    setPublishing(true);
    setError(null);

    const result = await publishScores(chapterId);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess("Scores published. Chapter marked as completed.");
      if (chapter) {
        setChapter({ ...chapter, status: "completed" });
      }
    }
    setPublishing(false);
  }

  async function handleSendCertificates() {
    if (!confirm("Send certificate emails to all teams with published scores? Each team member will receive an email with a download link.")) {
      return;
    }
    setSendingCerts(true);
    setError(null);

    const result = await sendCertificateEmails(chapterId);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(`Certificates sent to ${result.sent} team(s).${result.failed ? ` ${result.failed} failed.` : ""}`);
    }
    setSendingCerts(false);
  }

  if (loading) {
    return (
      <div>
        <p className="ad-text-muted">Loading...</p>
      </div>
    );
  }

  const isPublished = chapter?.status === "completed";
  const hasJuryRankings = Object.keys(juryData).length > 0;

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to Chapter
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="ad-title text-2xl">
            Scores{chapter ? `: ${chapter.name}` : ""}
          </h1>
          <p className="mt-1 ad-text-secondary">
            Review jury rankings, apply overrides, and publish results.
          </p>
        </div>
        {isPublished ? (
          <Badge variant="completed" light>Published</Badge>
        ) : (
          <Badge variant="announced" light>Draft</Badge>
        )}
      </div>

      {/* Scoring reference */}
      <Card className="mt-6">
        <p className="text-xs ad-text-muted">
          Scoring: 1st +{PLACEMENT_POINTS[1]} | 2nd +{PLACEMENT_POINTS[2]} | 3rd +
          {PLACEMENT_POINTS[3]} | 4th/5th +{PLACEMENT_POINTS[4]} | Participation +
          {PARTICIPATION_POINTS}
        </p>
      </Card>

      {/* Jury Rankings per challenge */}
      {hasJuryRankings && (
        <div className="mt-8">
          <h2 className="ad-heading text-lg">Jury Rankings</h2>
          <div className="mt-4 space-y-6">
            {challenges.map((challenge) => {
              const data = juryData[challenge.id];
              if (!data) return null;

              // Sort aggregated by total points descending
              const sortedTeams = Object.entries(data.aggregated)
                .sort(([, a], [, b]) => b - a);

              return (
                <Card key={challenge.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold">{challenge.title}</h3>
                      {challenge.sponsorName && (
                        <p className="text-sm ad-text-muted">
                          by {challenge.sponsorName}
                        </p>
                      )}
                    </div>
                    <Badge variant="completed" light>
                      {data.rankings.length} vote{data.rankings.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>

                  {/* Aggregated results */}
                  <div className="mt-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
                      Aggregated Results
                    </p>
                    <div className="mt-2 space-y-2">
                      {sortedTeams.map(([teamId, totalPoints], idx) => (
                        <div
                          key={teamId}
                          className="flex items-center justify-between rounded-lg border ad-border px-4 py-2.5"
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full ad-bg-warning font-mono text-xs font-bold ad-text-gold">
                              {idx + 1}
                            </span>
                            <span className="text-sm font-medium">
                              {getTeamName(teamId)}
                            </span>
                          </div>
                          <span className="font-mono text-sm ad-text-gold">
                            {totalPoints} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Individual juror votes */}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-medium ad-text-link">
                      Show individual votes ({data.rankings.length})
                    </summary>
                    <div className="mt-3 space-y-3">
                      {data.rankings.map((vote) => (
                        <div key={vote.jurorId} className="rounded-lg border ad-border p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{vote.jurorName}</p>
                            <span className="text-xs ad-text-muted">
                              {new Date(vote.submittedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {Object.entries(vote.ranking)
                              .sort(([a], [b]) => parseInt(a) - parseInt(b))
                              .map(([place, teamId]) => (
                                <span key={place} className="rounded-md border ad-border px-2 py-1 text-xs">
                                  #{place} {getTeamName(teamId)}
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {!hasJuryRankings && (
        <Card className="mt-8">
          <p className="ad-text-muted">
            No jury rankings submitted yet. Rankings will appear here once jury
            members submit their decisions.
          </p>
        </Card>
      )}

      {/* Score overrides table */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="ad-heading text-lg">Score Overrides</h2>
          {Object.keys(overrides).length > 0 && (
            <Button
              size="sm"
              onClick={handleSaveOverrides}
              disabled={saving}
            >
              {saving ? "Saving..." : `Save ${Object.keys(overrides).length} Override(s)`}
            </Button>
          )}
        </div>
        <p className="mt-1 text-sm ad-text-muted">
          Override individual team scores if needed. Changes are tracked as admin overrides.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b ad-border text-left text-sm ad-text-muted">
                <th className="pb-3 pr-4 font-medium">Team</th>
                <th className="pb-3 pr-4 font-medium">Current Placement</th>
                <th className="pb-3 pr-4 font-medium">Points</th>
                <th className="pb-3 pr-4 font-medium">Source</th>
                <th className="pb-3 font-medium">Override</th>
              </tr>
            </thead>
            <tbody>
              {teams
                .filter((team) => {
                  // Only show teams that have scores or jury rankings
                  const hasScore = getScoreForTeam(team.id);
                  const inJuryRanking = Object.values(juryData).some(
                    (d) => team.id in d.aggregated
                  );
                  return hasScore || inJuryRanking;
                })
                .map((team) => {
                  const score = getScoreForTeam(team.id);
                  const override = overrides[team.id];

                  return (
                    <tr
                      key={team.id}
                      className="border-b ad-border ad-bg-card-hover transition-colors"
                    >
                      <td className="py-3 pr-4 text-sm font-medium">{team.name}</td>
                      <td className="py-3 pr-4 text-sm">
                        {score?.placement
                          ? `#${score.placement}`
                          : score
                            ? "Participated"
                            : "-"}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-mono text-sm font-bold ad-text-gold">
                          {override
                            ? `+${override.points}`
                            : score
                              ? `+${score.points}`
                              : "0"}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        {override ? (
                          <Badge variant="announced" light>Override</Badge>
                        ) : score?.source === "jury" ? (
                          <Badge variant="completed" light>Jury</Badge>
                        ) : score ? (
                          <Badge variant="default" light>Admin</Badge>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <select
                          value={
                            override
                              ? override.placement === null
                                ? "participation"
                                : String(override.placement)
                              : ""
                          }
                          onChange={(e) =>
                            handleOverride(team.id, e.target.value)
                          }
                          className="rounded-lg border ad-border ad-bg-input px-3 py-1.5 text-sm ad-text focus:outline-none"
                          disabled={isPublished}
                        >
                          <option value="">Keep current</option>
                          <option value="1">1st (+{PLACEMENT_POINTS[1]})</option>
                          <option value="2">2nd (+{PLACEMENT_POINTS[2]})</option>
                          <option value="3">3rd (+{PLACEMENT_POINTS[3]})</option>
                          <option value="4">4th (+{PLACEMENT_POINTS[4]})</option>
                          <option value="5">5th (+{PLACEMENT_POINTS[5]})</option>
                          <option value="participation">
                            Participation (+{PARTICIPATION_POINTS})
                          </option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Errors / Success */}
      {error && (
        <p className="mt-4 rounded-lg ad-bg-error px-4 py-3 text-sm ad-text-error">{error}</p>
      )}
      {success && (
        <p className="mt-4 rounded-lg ad-bg-success px-4 py-3 text-sm ad-text-success">{success}</p>
      )}

      {/* Publish */}
      {!isPublished && (
        <Card className="mt-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">Publish Results</h3>
              <p className="mt-1 text-sm ad-text-muted">
                Publishing will make scores visible on the public leaderboard and set the chapter
                status to completed.
              </p>
              {scores.length === 0 && (
                <p className="mt-2 text-sm ad-text-warning">
                  No scores yet. Finalize the jury rankings to generate scores, or
                  publish anyway to complete the chapter with an empty leaderboard.
                </p>
              )}
            </div>
            <Button onClick={handlePublish} disabled={publishing}>
              {publishing ? "Publishing..." : "Publish Results"}
            </Button>
          </div>
        </Card>
      )}

      {/* Send Certificates (only when published) */}
      {isPublished && (
        <Card className="mt-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">Send Certificates</h3>
              <p className="mt-1 text-sm ad-text-muted">
                Email PDF certificate download links to all team members with published scores.
              </p>
            </div>
            <Button
              onClick={handleSendCertificates}
              disabled={sendingCerts}
            >
              {sendingCerts ? "Sending..." : "Send Certificate Emails"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
