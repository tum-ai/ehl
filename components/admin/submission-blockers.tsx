"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import type { BlockSummary } from "@/lib/submission-blocks";

const POLL_MS = 20_000;

/**
 * Live count of submission attempts that were REFUSED, for the chapter being
 * run right now.
 *
 * A blocked attempt writes no submission row, so without this panel a stuck team
 * is invisible until someone walks to the desk. Polls rather than rendering
 * once: during a submission window the useful question is "is this happening
 * now", which a page rendered twenty minutes ago cannot answer.
 *
 * Reasons are split by who can act. Anything on our side is shown first and
 * loudly: those teams cannot be helped by the desk, and several at once means
 * our own GitHub access is failing.
 */
export function SubmissionBlockers({
  chapterId,
  windowMinutes = 60,
}: {
  chapterId: string;
  windowMinutes?: number;
}) {
  const [summary, setSummary] = useState<BlockSummary | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/chapters/${chapterId}/submission-blocks?minutes=${windowMinutes}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      // A non-OK body is error-shaped, not a summary: only render a real one.
      if (data && typeof data === "object" && "counts" in data) {
        setSummary(data as BlockSummary);
        setCheckedAt(new Date().toLocaleTimeString());
      }
    } catch {
      // A failed poll must never blank a panel an operator is watching: keep
      // the last known figures and let the next tick correct them.
    }
  }, [chapterId, windowMinutes]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!summary) return null;

  // Nothing blocked is the normal state and worth stating positively, so an
  // empty panel is never confused with a panel that failed to load.
  if (summary.total === 0) {
    return (
      <Card>
        <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
          Blocked submission attempts
        </p>
        <p className="mt-1 text-sm ad-text">
          None in the last {summary.windowMinutes} minutes.
        </p>
        {checkedAt && (
          <p className="mt-1 text-xs ad-text-muted">Checked {checkedAt}, updates automatically.</p>
        )}
      </Card>
    );
  }

  const ours = summary.counts.filter((c) => c.side === "ours");
  const theirs = summary.counts.filter((c) => c.side === "theirs");

  return (
    <Card>
      <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
        Blocked submission attempts
      </p>
      <p className="mt-1 text-sm ad-text">
        {summary.total} in the last {summary.windowMinutes} minutes.
      </p>

      {ours.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            {summary.ourSideTotal} blocked by something only we can fix. The desk cannot
            help these teams: check the GitHub bot token and the snapshot status.
          </p>
          <ul className="mt-2 space-y-1">
            {ours.map((c) => (
              <li key={c.reason} className="text-sm text-amber-800">
                {c.label}: <span className="font-mono">{c.count}</span> attempt
                {c.count === 1 ? "" : "s"} from {c.teams} team{c.teams === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {theirs.length > 0 && (
        <ul className="mt-3 space-y-1">
          {theirs.map((c) => (
            <li key={c.reason} className="flex items-center justify-between text-sm">
              <span className="ad-text-secondary">{c.label}</span>
              <span className="ad-text-muted">
                <span className="font-mono ad-text">{c.count}</span> from {c.teams} team
                {c.teams === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {checkedAt && (
        <p className="mt-3 text-xs ad-text-muted">Checked {checkedAt}, updates automatically.</p>
      )}
    </Card>
  );
}
