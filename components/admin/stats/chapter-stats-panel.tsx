"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import type { ChapterDetailStats } from "@/lib/queries/admin-stats";

interface ChapterStatsPanelProps {
  chapterId: string;
}

function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full ad-bg-elevated overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono ad-text-muted w-10 text-right">
        {pct}%
      </span>
    </div>
  );
}

export function ChapterStatsPanel({ chapterId }: ChapterStatsPanelProps) {
  const [stats, setStats] = useState<ChapterDetailStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/chapters/${chapterId}/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [chapterId]);

  if (loading) {
    return <p className="text-sm ad-text-muted">Loading stats...</p>;
  }

  if (!stats) return null;

  const { applications: apps, challenges, totals } = stats;

  return (
    <div className="space-y-4">
      {/* Application pipeline */}
      <Card>
        <h3 className="ad-heading text-sm mb-3">Applications</h3>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <p className="text-2xl font-bold font-mono ad-text">{apps.total}</p>
            <p className="text-xs ad-text-muted">Total</p>
          </div>
          <div>
            <p className="text-2xl font-bold font-mono" style={{ color: "#22C55E" }}>
              {apps.checkedIn}
            </p>
            <p className="text-xs ad-text-muted">Checked In</p>
          </div>
          <div>
            <p className="text-2xl font-bold font-mono ad-text-gold">
              {totals.submittedTeams}
            </p>
            <p className="text-xs ad-text-muted">Submissions</p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <div className="flex justify-between ad-text-secondary mb-1">
              <span>Accepted</span>
              <span>{apps.accepted + apps.checkedIn} / {apps.total}</span>
            </div>
            <ProgressBar
              value={apps.accepted + apps.checkedIn}
              max={apps.total}
              color="#3B82F6"
            />
          </div>
          <div>
            <div className="flex justify-between ad-text-secondary mb-1">
              <span>Checked In</span>
              <span>{apps.checkedIn} / {apps.accepted + apps.checkedIn}</span>
            </div>
            <ProgressBar
              value={apps.checkedIn}
              max={apps.accepted + apps.checkedIn}
              color="#22C55E"
            />
          </div>
          <div>
            <div className="flex justify-between ad-text-secondary mb-1">
              <span>Submitted</span>
              <span>{totals.submittedTeams} / {totals.registeredTeams}</span>
            </div>
            <ProgressBar
              value={totals.submittedTeams}
              max={totals.registeredTeams}
              color="#E8B84B"
            />
          </div>
        </div>
        {(apps.pending > 0 || apps.waitlisted > 0) && (
          <div className="mt-3 flex gap-4 text-xs ad-text-muted">
            {apps.pending > 0 && <span>{apps.pending} pending</span>}
            {apps.rejected > 0 && <span>{apps.rejected} rejected</span>}
            {apps.waitlisted > 0 && <span>{apps.waitlisted} waitlisted</span>}
          </div>
        )}
      </Card>

      {/* Per-challenge breakdown */}
      {challenges.length > 0 && (
        <Card>
          <h3 className="ad-heading text-sm mb-3">Challenges</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b ad-border text-left">
                  <th className="pb-2 pr-4 font-medium ad-text-muted">Challenge</th>
                  <th className="pb-2 pr-4 font-medium ad-text-muted text-right">Teams</th>
                  <th className="pb-2 pr-4 font-medium ad-text-muted text-right">Submissions</th>
                  <th className="pb-2 font-medium ad-text-muted text-right">Jury</th>
                </tr>
              </thead>
              <tbody className="divide-y ad-border">
                {challenges.map((ch) => (
                  <tr key={ch.challengeId}>
                    <td className="py-2 pr-4">
                      <p className="font-medium ad-text">{ch.title}</p>
                      {ch.sponsorName && (
                        <p className="text-xs ad-text-muted">{ch.sponsorName}</p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono ad-text">
                      {ch.registrations}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono ad-text">
                      {ch.submissions}
                    </td>
                    <td className="py-2 text-right font-mono ad-text">
                      {ch.juryVoted}/{ch.juryAssigned}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
