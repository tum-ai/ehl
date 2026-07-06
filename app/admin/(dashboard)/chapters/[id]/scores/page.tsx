"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PLACEMENT_POINTS,
  PARTICIPATION_POINTS,
  getPublishReadiness,
  getPendingJuryTeamIds,
  getJudgedUnscoredChallenges,
  findDuplicatePlacements,
} from "@/lib/scoring";
import { publishScores, sendCertificateEmails } from "@/lib/actions/admin";

interface Team {
  id: string;
  name: string;
}

interface Challenge {
  id: string;
  title: string;
  sponsorName: string | null;
  isScored: boolean;
  juryFinalizedAt: string | null;
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
  challengeId: string | null;
}

interface Registration {
  teamId: string;
  challengeId: string | null;
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
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ScoreOverride>>({});
  // Challenge picks made before (or without) a placement pick. Kept separate
  // from `overrides` so changing only the challenge of a score-less team does
  // NOT fabricate a pending participation score.
  const [challengeChoices, setChallengeChoices] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [sendingCerts, setSendingCerts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    params.then(async ({ id }) => {
      setChapterId(id);

      const [teamsRes, challengesRes, chapterRes, registrationsRes] = await Promise.all([
        fetch("/api/admin/teams").then((r) => r.json()),
        fetch(`/api/admin/chapters/${id}/challenges`).then((r) => r.json()),
        fetch(`/api/admin/chapters/${id}/details`).then((r) => r.json()).catch(() => null),
        fetch(`/api/admin/chapters/${id}/registrations`).then((r) => r.json()).catch(() => []),
      ]);

      setTeams(teamsRes);
      setChallenges(challengesRes);
      setRegistrations(Array.isArray(registrationsRes) ? registrationsRes : []);
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

  // Teams whose jury results are displayed but not yet materialized into `scores`
  // (scored + not finalized). Extracted to lib/scoring for unit testing.
  function pendingJuryTeamIds(): string[] {
    const aggregated: Record<string, Record<string, number>> = {};
    for (const [challengeId, data] of Object.entries(juryData)) {
      aggregated[challengeId] = data.aggregated;
    }
    return getPendingJuryTeamIds(challenges, aggregated);
  }

  // The challenge a team's score should be attributed to, in priority order:
  // pending override edit > explicit dropdown pick > existing score (INCLUDING
  // an explicit null, which must not be masked by the registration) > the
  // team's chapter registration.
  function challengeIdForTeam(teamId: string): string | null {
    const override = overrides[teamId];
    if (override !== undefined) return override.challengeId;
    if (teamId in challengeChoices) return challengeChoices[teamId];
    const score = getScoreForTeam(teamId);
    if (score) return score.challengeId;
    return registrations.find((r) => r.teamId === teamId)?.challengeId ?? null;
  }

  function handleOverride(teamId: string, placement: string) {
    // "Keep current" (empty value) clears a pending override instead of
    // recording a participation score.
    if (placement === "") {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[teamId];
        return next;
      });
      return;
    }
    const placeNum = placement === "participation" ? null : parseInt(placement);
    const points = placeNum ? (PLACEMENT_POINTS[placeNum] ?? 0) : PARTICIPATION_POINTS;

    setOverrides((prev) => ({
      ...prev,
      [teamId]: {
        teamId,
        placement: placeNum,
        points,
        challengeId: prev[teamId]?.challengeId ?? challengeIdForTeam(teamId),
      },
    }));
  }

  function handleOverrideChallenge(teamId: string, challengeId: string) {
    const value = challengeId || null;
    // Remember the pick without fabricating a score; if a placement override is
    // already pending, update it in place.
    setChallengeChoices((prev) => ({ ...prev, [teamId]: value }));
    setOverrides((prev) =>
      prev[teamId] ? { ...prev, [teamId]: { ...prev[teamId], challengeId: value } } : prev
    );
  }

  async function handleSaveOverrides() {
    if (Object.keys(overrides).length === 0) return;

    // Soft duplicate-placement check (findDuplicatePlacements, unit-tested):
    // legitimate ties exist, so this warns instead of blocking — but silent
    // double-1st entries within one challenge (the usual manual-entry slip)
    // must never happen unnoticed.
    const finalRows = new Map<string, { teamId: string; placement: number | null; challengeId: string | null }>();
    for (const s of scores) {
      finalRows.set(s.teamId, { teamId: s.teamId, placement: s.placement, challengeId: s.challengeId });
    }
    for (const o of Object.values(overrides)) {
      finalRows.set(o.teamId, { teamId: o.teamId, placement: o.placement, challengeId: o.challengeId });
    }
    const dupes = findDuplicatePlacements([...finalRows.values()]);
    if (dupes.length > 0) {
      const lines = dupes
        .map((d) => `#${d.placement}: ${d.teamIds.map(getTeamName).join(", ")}`)
        .join("\n");
      if (
        !confirm(
          `Warning: multiple teams share the same placement within one challenge:\n${lines}\n\nSave anyway (e.g. intentional tie)?`
        )
      ) {
        return;
      }
    }

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
    // never be completed. The confirm dialog reflects what publish will ACTUALLY
    // surface: only rows in the `scores` table are published, NOT the live jury
    // aggregation shown on this page. So warn loudly when displayed jury results
    // have not yet been finalized into scores (they would silently vanish), and
    // when there is genuinely nothing to publish (empty leaderboard).
    const readiness = getPublishReadiness(
      scores.map((s) => s.teamId),
      pendingJuryTeamIds()
    );
    let message: string;
    if (readiness.kind === "unfinalized") {
      message =
        `Jury results are shown for ${readiness.pendingTeamCount} team(s) that have NOT been finalized into scores. ` +
        "Publishing now will NOT include them on the public leaderboard. Finalize the jury rankings first (Jury page) so they count. Publish anyway?";
    } else if (readiness.kind === "empty") {
      message =
        "This chapter has NO scores yet. Publishing will mark it as completed with an empty leaderboard. If you expected scores, finalize the jury rankings first. Continue anyway?";
    } else {
      message =
        "Publish scores and mark this chapter as completed? This will make results visible on the public leaderboard.";
    }
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
  // Reconcile the two reads (persisted `scores` vs displayed jury aggregation) so
  // the publish UI reflects what will actually surface publicly.
  const publishReadiness = getPublishReadiness(
    scores.map((s) => s.teamId),
    pendingJuryTeamIds()
  );
  // Challenges the jury ranked but that produce no league points (unscored). This
  // is the usual reason the page shows "No scores yet" while jury results display
  // above: the challenge is a community challenge (or was accidentally toggled
  // unscored). Surface it so the no-op is never silent.
  const judgedUnscored = getJudgedUnscoredChallenges(
    challenges,
    Object.fromEntries(
      Object.entries(juryData).map(([cid, d]) => [cid, d.aggregated])
    )
  );

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
        <Card className="mt-8 border-amber-400 bg-amber-50">
          <p className="text-sm font-bold text-amber-900">
            Manual results mode: no jury votes recorded for this chapter.
          </p>
          <p className="mt-1 text-sm text-amber-800">
            You can enter the final ranking by hand in the table below (e.g. when
            scoring happened on paper at the event). Pick each team&apos;s placement
            and challenge, save, then publish. Every entry is recorded as an admin
            override in the audit log. If the jury is still going to vote digitally,
            do NOT enter scores here: finalized jury rankings would be mixed with
            or overwritten by your manual entries.
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
          {hasJuryRankings
            ? "Override individual team scores if needed. Changes are tracked as admin overrides."
            : "Enter each registered team's final placement and challenge. Changes are tracked as admin overrides."}
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b ad-border text-left text-sm ad-text-muted">
                <th className="pb-3 pr-4 font-medium">Team</th>
                <th className="pb-3 pr-4 font-medium">Current Placement</th>
                <th className="pb-3 pr-4 font-medium">Points</th>
                <th className="pb-3 pr-4 font-medium">Source</th>
                <th className="pb-3 pr-4 font-medium">Challenge</th>
                <th className="pb-3 font-medium">Override</th>
              </tr>
            </thead>
            <tbody>
              {teams
                .filter((team) => {
                  // Teams with scores or jury rankings, PLUS every team
                  // registered for this chapter — otherwise a no-jury chapter
                  // (paper scoring at the event) renders an empty table and a
                  // manual ranking can never be entered from scratch.
                  const hasScore = getScoreForTeam(team.id);
                  const inJuryRanking = Object.values(juryData).some(
                    (d) => team.id in d.aggregated
                  );
                  const isRegistered = registrations.some((r) => r.teamId === team.id);
                  return hasScore || inJuryRanking || isRegistered;
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
                      <td className="py-3 pr-4">
                        <select
                          value={challengeIdForTeam(team.id) ?? ""}
                          onChange={(e) =>
                            handleOverrideChallenge(team.id, e.target.value)
                          }
                          className="max-w-[180px] rounded-lg border ad-border ad-bg-input px-3 py-1.5 text-sm ad-text focus:outline-none"
                          disabled={isPublished}
                        >
                          <option value="">No challenge</option>
                          {challenges.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
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
              {publishReadiness.kind === "unfinalized" && (
                <p className="mt-2 text-sm ad-text-warning">
                  Jury results are shown for {publishReadiness.pendingTeamCount}{" "}
                  team(s) that have not been finalized into scores. They will NOT
                  appear on the public leaderboard until you finalize the jury
                  rankings on the{" "}
                  <Link href="/admin/jury" className="underline ad-text-link">
                    Jury page
                  </Link>
                  . Publishing now publishes only finalized scores.
                </p>
              )}
              {publishReadiness.kind === "empty" && judgedUnscored.length > 0 && (
                <p className="mt-2 text-sm ad-text-warning">
                  No league scores yet. The jury ranked{" "}
                  {judgedUnscored.length === 1
                    ? `challenge "${judgedUnscored[0].title ?? judgedUnscored[0].id}"`
                    : `${judgedUnscored.length} challenges`}
                  , but {judgedUnscored.length === 1 ? "it is" : "they are"} marked{" "}
                  COMMUNITY (unscored), so {judgedUnscored.length === 1 ? "it produces" : "they produce"}{" "}
                  no league points. If {judgedUnscored.length === 1 ? "it" : "any"} should
                  count, mark {judgedUnscored.length === 1 ? "it" : "them"} as Scored on the{" "}
                  <Link
                    href={`/admin/chapters/${chapterId}/challenges`}
                    className="underline ad-text-link"
                  >
                    Challenges page
                  </Link>
                  , then use Generate scores on the{" "}
                  <Link href="/admin/jury" className="underline ad-text-link">
                    Jury page
                  </Link>
                  .
                </p>
              )}
              {publishReadiness.kind === "empty" && judgedUnscored.length === 0 && (
                <p className="mt-2 text-sm ad-text-warning">
                  No scores yet. Finalize the jury rankings on the{" "}
                  <Link href="/admin/jury" className="underline ad-text-link">
                    Jury page
                  </Link>{" "}
                  to generate scores, or publish anyway to complete the chapter with an
                  empty leaderboard.
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
