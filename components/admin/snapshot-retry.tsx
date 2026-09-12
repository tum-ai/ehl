"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retrySnapshots } from "@/lib/actions/submissions";

/**
 * Admin control to re-run a missing repository snapshot.
 *
 * Surfaces the LIVE GitHub error on failure rather than a generic message: the
 * whole point of a retry is telling an operator whether to wait out a secondary
 * rate limit, rotate the bot token, or chase a team that revoked access.
 */
export function SnapshotRetry({
  submissionId,
  chapterId,
  label = "Retry snapshot",
}: {
  submissionId?: string;
  chapterId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);
    setFailed(false);

    const res = await retrySnapshots({ submissionId, chapterId });

    if ("error" in res) {
      setFailed(true);
      setResult(res.error);
      setRunning(false);
      return;
    }

    if (res.attempted === 0) {
      setResult("Nothing to retry: no submission is missing a snapshot.");
    } else if (res.failures.length === 0) {
      setResult(`Snapshotted ${res.succeeded} of ${res.attempted}.`);
      router.refresh();
    } else {
      setFailed(true);
      setResult(
        `Snapshotted ${res.succeeded} of ${res.attempted}. Still failing: ${res.failures.join("; ")}`
      );
      router.refresh();
    }

    setRunning(false);
  }

  return (
    <div>
      <Button type="button" onClick={run} disabled={running} variant="secondary">
        {running ? "Retrying..." : label}
      </Button>
      {result && (
        <p className={`mt-2 text-sm ${failed ? "text-amber-700" : "ad-text-secondary"}`}>
          {result}
        </p>
      )}
    </div>
  );
}
