"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminSetTeamChallenge } from "@/lib/actions/admin";

interface ChallengeOption {
  id: string;
  title: string;
}

/**
 * Admin control to assign or change a team's challenge for the active chapter.
 * Only rendered while submissions are still open (the parent gates this; the
 * server action re-checks authoritatively). Shows the current challenge and a
 * dropdown to override it. Audit-logged server-side.
 */
export function TeamChallengeControl({
  teamId,
  chapterId,
  currentChallengeId,
  challenges,
}: {
  teamId: string;
  chapterId: string;
  currentChallengeId: string | null;
  challenges: ChallengeOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const current = challenges.find((c) => c.id === currentChallengeId) ?? null;

  async function setChallenge(challengeId: string) {
    if (!challengeId || challengeId === currentChallengeId) return;
    const title = challenges.find((c) => c.id === challengeId)?.title ?? "this challenge";
    const verb = currentChallengeId ? "change" : "assign";
    if (!confirm(`${verb === "change" ? "Change" : "Assign"} this team's challenge to "${title}"?`)) {
      return;
    }
    setBusy(true);
    const res = await adminSetTeamChallenge(teamId, challengeId, chapterId);
    setBusy(false);
    if (res.error) {
      alert(res.error);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="text-xs">
      <div className="mb-0.5 ad-text-muted">
        {current ? (
          <span className="ad-text-secondary">{current.title}</span>
        ) : (
          <span className="font-medium text-amber-700">No challenge</span>
        )}
      </div>
      <select
        disabled={busy || challenges.length === 0}
        defaultValue={currentChallengeId ?? ""}
        onChange={(e) => setChallenge(e.target.value)}
        className="ad-border ad-bg-input ad-text mt-0.5 rounded border px-1 py-1"
      >
        <option value="">{currentChallengeId ? "change to…" : "assign…"}</option>
        {challenges.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
            {c.id === currentChallengeId ? " (current)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
