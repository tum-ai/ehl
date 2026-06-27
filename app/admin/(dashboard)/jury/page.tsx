"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { inviteJury } from "@/lib/actions/auth";
import { removeJuryAssignment, removeJuryMember, finalizeJuryVotes, regenerateScoresFromFinalizedRankings } from "@/lib/actions/jury";
import { shouldShowFinalizedBlock, hasJury as hasJuryFor } from "@/lib/jury-view";

interface Chapter {
  id: string;
  name: string;
  status: string;
}

interface Challenge {
  id: string;
  chapterId: string;
  title: string;
  sponsorName: string | null;
  // Whether this challenge produces league points. Community (unscored)
  // challenges are judged but generate NO scores: the UI must say so instead of
  // implying finalizing creates points.
  isScored: boolean;
  juryFinalizedAt: string | null;
}

interface Juror {
  userId: string;
  name: string | null;
  email: string | null;
  status: "pending" | "voted" | "skipped";
}

interface ChallengeProgress {
  chapterId: string;
  finalized: boolean;
  finalizedAt: string | null;
  jurors: Juror[];
}

interface JuryUser {
  id: string;
  name: string | null;
  email: string | null;
}

export default function AdminJuryPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [selectedChallengeId, setSelectedChallengeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [progress, setProgress] = useState<Record<string, ChallengeProgress>>({});
  const [juryUsers, setJuryUsers] = useState<JuryUser[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    // Only accept the EXPECTED shape from each endpoint. A non-OK response (e.g.
    // a 403 returning `{ error: "..." }`) must never poison state — feeding an
    // error object into `progress` then iterating `cp.jurors` over it would crash
    // the whole page. Default to a safe empty value instead.
    const okJson = async <T,>(url: string, fallback: T, isValid: (v: unknown) => boolean): Promise<T> => {
      try {
        const r = await fetch(url);
        if (!r.ok) return fallback;
        const data = await r.json();
        return isValid(data) ? (data as T) : fallback;
      } catch {
        return fallback;
      }
    };
    const isArray = (v: unknown) => Array.isArray(v);
    const isObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

    try {
      const [chaptersRes, progressRes, usersRes] = await Promise.all([
        okJson<Chapter[]>("/api/admin/jury/chapters", [], isArray),
        okJson<Record<string, ChallengeProgress>>("/api/admin/jury/progress", {}, isObject),
        okJson<JuryUser[]>("/api/admin/jury/users", [], isArray),
      ]);

      setChapters(chaptersRes);
      setProgress(progressRes);
      setJuryUsers(usersRes);

      // Load challenges for all chapters
      const allChallenges: Challenge[] = [];
      for (const ch of chaptersRes) {
        const chChallenges = await okJson<Challenge[]>(
          `/api/admin/chapters/${ch.id}/challenges`,
          [],
          isArray
        );
        allChallenges.push(
          ...chChallenges.map((c: Challenge) => ({ ...c, chapterId: ch.id }))
        );
      }
      setChallenges(allChallenges);
    } catch {
      // silently fail
    }
    setDataLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter challenges by selected chapter
  const filteredChallenges = selectedChapterId
    ? challenges.filter((c) => c.chapterId === selectedChapterId)
    : [];

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedChallengeId) {
      setError("Please select a challenge.");
      return;
    }

    const challenge = challenges.find((c) => c.id === selectedChallengeId);
    if (!challenge) return;

    setLoading(true);
    const result = await inviteJury(email, name, selectedChallengeId, challenge.chapterId);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(`Invitation sent to ${email}`);
      setEmail("");
      setName("");
      // Reload data
      await loadData();
    }
    setLoading(false);
  }

  async function handleFinalize(challengeId: string) {
    const challengeProgress = progress[challengeId];
    const voted = challengeProgress?.jurors.filter((j) => j.status === "voted").length ?? 0;
    if (voted === 0) {
      alert("At least one jury member must vote before finalizing.");
      return;
    }
    const challenge = challenges.find((c) => c.id === challengeId);
    // Be honest about what finalizing will do. An unscored (community) challenge
    // is judged but produces NO league points: never imply scores are generated.
    const confirmMsg = challenge && !challenge.isScored
      ? "This is a COMMUNITY (unscored) challenge. Finalizing records the jury result but generates NO league scores. If this challenge should award points, cancel and mark it Scored on the Challenges page first. Finalize anyway?"
      : "Finalize jury voting for this challenge? This will generate scores based on all submitted votes.";
    if (!confirm(confirmMsg)) return;

    setFinalizingId(challengeId);
    const result = await finalizeJuryVotes(challengeId);
    if (result.error) {
      alert(result.error);
    } else {
      // Tell the admin exactly what happened so it is never a silent no-op.
      if (result.isScored === false) {
        alert(
          "Finalized. This is a community (unscored) challenge, so NO league scores were generated. To award points, mark the challenge as Scored on the Challenges page, then use \"Generate scores\" here."
        );
      } else if (typeof result.scoresWritten === "number") {
        alert(`Finalized. ${result.scoresWritten} score row(s) generated.`);
      }
      await loadData();
    }
    setFinalizingId(null);
  }

  // Recovery: a challenge finalized while it was (accidentally) unscored, then
  // corrected to Scored, can still get its scores generated from the already
  // finalized jury rankings (finalize refuses to run twice).
  async function handleGenerateScores(challengeId: string) {
    if (!confirm("Generate league scores from the finalized jury rankings for this challenge?")) return;
    setFinalizingId(challengeId);
    const result = await regenerateScoresFromFinalizedRankings(challengeId);
    if (result.error) {
      alert(result.error);
    } else {
      alert(`Done. ${result.scoresWritten ?? 0} score row(s) generated.`);
      await loadData();
    }
    setFinalizingId(null);
  }

  async function handleRemoveJuror(userId: string, challengeId: string) {
    if (!confirm("Remove this jury member from this challenge?")) return;
    const result = await removeJuryAssignment(userId, challengeId);
    if (!result.error) {
      await loadData();
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm("Remove this jury member and all their assignments?")) return;
    const result = await removeJuryMember(userId);
    if (!result.error) {
      await loadData();
    }
  }

  function getChapterName(chapterId: string): string {
    return chapters.find((c) => c.id === chapterId)?.name || "Unknown";
  }

  function getChallengeName(challengeId: string): string {
    return challenges.find((c) => c.id === challengeId)?.title || "Unknown";
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "voted":
        return <Badge variant="completed">Voted</Badge>;
      case "skipped":
        return <Badge variant="upcoming">Skipped</Badge>;
      default:
        return <Badge variant="announced" light>Pending</Badge>;
    }
  }

  // Group ALL challenges by chapter (not just those with jury)
  const challengesByChapter: Record<string, Challenge[]> = {};
  for (const c of challenges) {
    if (!challengesByChapter[c.chapterId]) challengesByChapter[c.chapterId] = [];
    challengesByChapter[c.chapterId].push(c);
  }

  function getChallengeStatus(challengeId: string): "finalized" | "ready" | "in_progress" | "no_jury" {
    const cp = progress[challengeId];
    if (!cp) return "no_jury";
    if (cp.finalized) return "finalized";
    const voted = cp.jurors.filter((j) => j.status === "voted").length;
    const pending = cp.jurors.filter((j) => j.status === "pending").length;
    if (pending === 0 && voted > 0) return "ready";
    return "in_progress";
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/admin/chapters"
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to chapters
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Jury Management</h1>
      <p className="mt-1 ad-text-secondary">
        Invite jury members directly to challenges and track voting progress.
      </p>

      {/* Invite form */}
      <Card className="mt-8">
        <h2 className="ad-heading text-lg">Invite Jury Member to Challenge</h2>
        <p className="mt-1 text-sm ad-text-muted">
          The jury member receives a magic link email and is automatically assigned to the selected challenge.
        </p>

        <form onSubmit={handleInvite} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm ad-text-muted">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Jury member name"
                className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm ad-text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="jury@sponsor.com"
                className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm ad-text-muted">Match</label>
              <select
                value={selectedChapterId}
                onChange={(e) => {
                  setSelectedChapterId(e.target.value);
                  setSelectedChallengeId("");
                }}
                required
                className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              >
                <option value="">Select match...</option>
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm ad-text-muted">Challenge</label>
              <select
                value={selectedChallengeId}
                onChange={(e) => setSelectedChallengeId(e.target.value)}
                required
                disabled={!selectedChapterId}
                className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none disabled:opacity-50"
              >
                <option value="">Select challenge...</option>
                {filteredChallenges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}{c.sponsorName ? ` (${c.sponsorName})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm ad-text-error">{error}</p>}
          {success && <p className="text-sm ad-text-success">{success}</p>}

          <Button type="submit" disabled={loading}>
            {loading ? "Sending..." : "Send Invitation"}
          </Button>
        </form>
      </Card>

      {/* Challenges grouped by Chapter with jury assignments */}
      {!dataLoading && Object.keys(challengesByChapter).length > 0 && (
        <div className="mt-8 space-y-8">
          {Object.entries(challengesByChapter).map(([chapterId, chapterChallenges]) => (
            <div key={chapterId}>
              <h2 className="text-sm font-bold uppercase tracking-wider ad-text-muted">
                {getChapterName(chapterId)}
              </h2>

              <div className="mt-3 space-y-4">
                {chapterChallenges.map((challenge) => {
                  const cp = progress[challenge.id];
                  const hasJury = hasJuryFor(cp);
                  const total = cp?.jurors.length ?? 0;
                  const voted = cp?.jurors.filter((j) => j.status === "voted").length ?? 0;
                  const skipped = cp?.jurors.filter((j) => j.status === "skipped").length ?? 0;
                  const pending = cp?.jurors.filter((j) => j.status === "pending").length ?? 0;
                  const status = getChallengeStatus(challenge.id);

                  const cardBorder =
                    status === "finalized"
                      ? "ad-border-success"
                      : status === "ready"
                        ? "ad-border-success shadow-[0_0_12px_rgba(34,197,94,0.08)]"
                        : "";

                  return (
                    <Card key={challenge.id} className={cardBorder}>
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="ad-heading text-lg">{challenge.title}</h3>
                          {challenge.sponsorName && (
                            <p className="text-sm ad-text-muted">by {challenge.sponsorName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {status === "finalized" ? (
                            <Badge variant="completed">Finalized</Badge>
                          ) : status === "ready" ? (
                            <Badge variant="completed">Ready to finalize</Badge>
                          ) : hasJury ? (
                            <Badge variant="announced" light>
                              {voted + skipped}/{total} done
                            </Badge>
                          ) : (
                            <Badge variant="default" light>No jury</Badge>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      {hasJury && !cp.finalized && total > 0 && (
                        <div className="mt-4">
                          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-surface-deep">
                            {voted > 0 && (
                              <div
                                className="bg-green-500 rounded-full transition-all"
                                style={{ width: `${(voted / total) * 100}%` }}
                              />
                            )}
                            {skipped > 0 && (
                              <div
                                className="bg-yellow-500 rounded-full transition-all"
                                style={{ width: `${(skipped / total) * 100}%` }}
                              />
                            )}
                          </div>
                          <div className="mt-1.5 flex gap-4 text-xs ad-text-muted">
                            <span className="flex items-center gap-1">
                              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                              {voted} voted
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
                              {skipped} skipped
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block h-2 w-2 rounded-full bg-surface-deep border ad-border" />
                              {pending} pending
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Juror list */}
                      {hasJury ? (
                        <div className="mt-4 space-y-2">
                          {cp.jurors.map((juror) => (
                            <div
                              key={juror.userId}
                              className="flex items-center justify-between rounded-lg border ad-border px-3 py-2"
                            >
                              <div className="flex items-center gap-3">
                                {getStatusBadge(juror.status)}
                                <div>
                                  <p className="text-sm font-medium">{juror.name || "Unnamed"}</p>
                                  <p className="text-xs ad-text-muted">{juror.email}</p>
                                </div>
                              </div>
                              {!cp.finalized && (
                                <button
                                  onClick={() => handleRemoveJuror(juror.userId, challenge.id)}
                                  className="rounded-lg px-3 py-1.5 text-xs font-medium ad-text-error hover:bg-red-50 transition-colors"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-4 text-sm ad-text-muted">
                          No jury members assigned yet. Use the invite form above to add jurors.
                        </p>
                      )}

                      {/* Finalize button */}
                      {hasJury && !cp.finalized && voted > 0 && (
                        <div className="mt-4 border-t ad-border pt-4">
                          {pending === 0 ? (
                            <p className="mb-3 text-sm ad-text-success">
                              All jury members are done. {voted} vote{voted !== 1 ? "s" : ""} submitted, {skipped} skipped.
                            </p>
                          ) : (
                            <p className="mb-3 text-xs ad-text-muted">
                              {pending} jury member{pending !== 1 ? "s" : ""} still pending. You can finalize early or wait for all votes.
                            </p>
                          )}
                          <Button
                            onClick={() => handleFinalize(challenge.id)}
                            disabled={finalizingId === challenge.id}
                          >
                            {finalizingId === challenge.id
                              ? "Finalizing..."
                              : `Finalize Voting (${voted} vote${voted !== 1 ? "s" : ""})`}
                          </Button>
                        </div>
                      )}

                      {/* Finalized state: be explicit about scores, and offer a
                          recovery path. A challenge can be finalized while it was
                          (accidentally) unscored; after marking it Scored the
                          admin can generate scores from the finalized rankings.
                          shouldShowFinalizedBlock is null-safe — a challenge with no
                          jury progress entry has cp === undefined, and an unguarded
                          cp.finalized here crashed the whole /admin/jury page. */}
                      {shouldShowFinalizedBlock(cp) && (
                        <div className="mt-4 border-t ad-border pt-4">
                          {challenge.isScored ? (
                            <>
                              <p className="mb-3 text-sm ad-text-muted">
                                Finalized. League scores were generated from the jury rankings.
                                If this challenge was unscored when first finalized and you have
                                since marked it Scored, generate the missing scores now.
                              </p>
                              <Button
                                onClick={() => handleGenerateScores(challenge.id)}
                                disabled={finalizingId === challenge.id}
                              >
                                {finalizingId === challenge.id ? "Working..." : "Generate scores"}
                              </Button>
                            </>
                          ) : (
                            <p className="text-sm ad-text-warning">
                              Finalized as a community (unscored) challenge: jury results were
                              recorded but NO league points were generated. To award points,
                              mark this challenge as Scored on the Challenges page, then return
                              here and use Generate scores.
                            </p>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unassigned jury members (those with accounts but no current assignments) */}
      {!dataLoading && juryUsers.length > 0 && (() => {
        // Find jury users who have no assignments across any challenge
        const assignedUserIds = new Set<string>();
        for (const cp of Object.values(progress)) {
          for (const j of cp.jurors) {
            assignedUserIds.add(j.userId);
          }
        }
        const unassigned = juryUsers.filter((u) => !assignedUserIds.has(u.id));
        if (unassigned.length === 0) return null;

        return (
          <Card className="mt-8">
            <h2 className="ad-heading text-lg">Unassigned Jury Members</h2>
            <p className="mt-1 text-sm ad-text-muted">
              These jury accounts exist but are not assigned to any challenge.
            </p>
            <div className="mt-4 space-y-2">
              {unassigned.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-lg border ad-border px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{user.name || "Unnamed"}</p>
                    <p className="text-sm ad-text-muted">{user.email}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(user.id)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium ad-text-error hover:bg-red-50 transition-colors"
                  >
                    Remove Account
                  </button>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Info */}
      <Card className="mt-6">
        <h3 className="font-bold">How jury voting works</h3>
        <ol className="mt-3 space-y-2 text-sm ad-text-secondary list-decimal list-inside">
          <li>Invite a jury member to a specific challenge via the form above.</li>
          <li>They receive a magic link email to access the jury portal.</li>
          <li>During pitching, they can view submissions and code reviews.</li>
          <li>Each jury member individually submits their Top 5 ranking, or skips.</li>
          <li>Once enough votes are in, finalize to aggregate votes and generate scores.</li>
        </ol>
      </Card>
    </div>
  );
}
