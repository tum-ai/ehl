import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LimitBanner } from "@/components/admin/limit-banner";
import { requireGlobalAdminPage } from "@/lib/admin-auth";
import {
  getAllSubmissions,
  getAllChallengeRegistrations,
  getChaptersAdmin,
  getChallengesForChapter,
  getTeams,
} from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { snapshotState, snapshotStatusLabel, type SnapshotState } from "@/lib/snapshot-status";
import { SnapshotRetry } from "@/components/admin/snapshot-retry";
import type { Challenge, Chapter } from "@/lib/types";

/**
 * Global-admin view of every submission across all chapters. Also surfaces teams
 * that REGISTERED for a challenge but never submitted ("No submission"), so admins
 * can see who is missing an entry.
 *
 * Global admins ONLY: RLS does not grant chapter_admins read access to the
 * submissions table, so the view is not functional for them; we gate it to global
 * admins rather than show a misleadingly empty page.
 */
export default async function AdminSubmissionsPage() {
  await requireGlobalAdminPage();

  const [
    { submissions, limit: subLimit, limited: subLimited },
    { registrations, limit: regLimit, limited: regLimited },
    chapters,
    teams,
  ] = await Promise.all([
    getAllSubmissions(),
    getAllChallengeRegistrations(),
    getChaptersAdmin(),
    getTeams(),
  ]);

  // Load challenges for every chapter and build a challengeId -> challenge map.
  const challengeLists = await Promise.all(
    chapters.map((c) => getChallengesForChapter(c.id))
  );
  const challengeById = new Map<string, Challenge>();
  for (const list of challengeLists) {
    for (const ch of list) challengeById.set(ch.id, ch);
  }
  const chapterById = new Map<string, Chapter>(chapters.map((c) => [c.id, c]));
  const teamName = (id: string) =>
    teams.find((t) => t.id === id)?.name ?? "Unknown team";

  // One row per submission, plus one row per registration that has NO submission.
  type Row = {
    key: string;
    chapterId: string | null;
    chapterName: string;
    challengeTitle: string;
    teamName: string;
    submitted: boolean;
    submissionId: string | null;
    projectName: string | null;
    updatedAt: string | null;
    snapshot: SnapshotState | null;
  };

  const submittedKeys = new Set(
    submissions.map((s) => `${s.challengeId}:${s.teamId}`)
  );

  const chapterFor = (challengeId: string): Chapter | undefined => {
    const ch = challengeById.get(challengeId);
    return ch ? chapterById.get(ch.chapterId) : undefined;
  };

  const rows: Row[] = [];

  for (const s of submissions) {
    const challenge = challengeById.get(s.challengeId);
    const chapter = chapterFor(s.challengeId);
    rows.push({
      key: `sub:${s.id}`,
      chapterId: chapter?.id ?? null,
      chapterName: chapter?.name ?? "Unknown match",
      challengeTitle: challenge?.title ?? "Unknown challenge",
      teamName: teamName(s.teamId),
      submitted: true,
      submissionId: s.id,
      projectName: s.projectName,
      updatedAt: s.updatedAt,
      snapshot: snapshotState({ forkUrl: s.forkUrl, fields: s.fields }),
    });
  }

  for (const r of registrations) {
    if (submittedKeys.has(`${r.challengeId}:${r.teamId}`)) continue;
    const challenge = challengeById.get(r.challengeId);
    const chapter = chapterFor(r.challengeId);
    rows.push({
      key: `reg:${r.id}`,
      chapterId: chapter?.id ?? null,
      chapterName: chapter?.name ?? "Unknown match",
      challengeTitle: challenge?.title ?? "Unknown challenge",
      teamName: teamName(r.teamId),
      submitted: false,
      submissionId: null,
      projectName: null,
      updatedAt: null,
      snapshot: null,
    });
  }

  // Submitted first (newest first), then missing submissions.
  rows.sort((a, b) => {
    if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
    if (a.submitted && b.submitted) {
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    }
    return a.teamName.localeCompare(b.teamName);
  });

  const submittedCount = rows.filter((r) => r.submitted).length;
  const missingCount = rows.length - submittedCount;
  // Forks still owed. These are the ones a juror cannot open on a private repo,
  // so they are counted in the header rather than buried in the table.
  const missingSnapshotRows = rows.filter((r) => r.snapshot === "missing");
  const missingSnapshotCount = missingSnapshotRows.length;

  // One retry control per affected match, so an operator can re-run the match
  // that is actually being judged instead of every chapter in the season.
  const chaptersMissingSnapshots = Array.from(
    missingSnapshotRows.reduce((acc, r) => {
      if (!r.chapterId) return acc;
      acc.set(r.chapterId, { name: r.chapterName, count: (acc.get(r.chapterId)?.count ?? 0) + 1 });
      return acc;
    }, new Map<string, { name: string; count: number }>())
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="ad-title text-2xl">Submissions</h1>
        <p className="mt-1 ad-text-secondary">
          {submittedCount} submitted, {missingCount} registered without a
          submission.
        </p>
        {missingSnapshotCount > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-800">
              {missingSnapshotCount} submission{missingSnapshotCount === 1 ? "" : "s"} still
              missing a repository snapshot. The jury sees the team&apos;s own repository
              URL for these, which they cannot open if it is private.
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              {chaptersMissingSnapshots.map(([chapterId, info]) => (
                <SnapshotRetry
                  key={chapterId}
                  chapterId={chapterId}
                  label={`Retry ${info.count} in ${info.name}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <LimitBanner count={subLimited ? subLimit : 0} limit={subLimit} label="submissions" />
      <LimitBanner
        count={regLimited ? regLimit : 0}
        limit={regLimit}
        label="challenge registrations"
      />

      <Card className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b ad-border text-left">
                <th className="pb-3 pr-4 font-medium ad-text-muted">Match</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Challenge</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Team</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Project</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Snapshot</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Updated</th>
                <th className="pb-3 font-medium ad-text-muted"></th>
              </tr>
            </thead>
            <tbody className="divide-y ad-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center ad-text-muted">
                    No submissions yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.key} className={row.submitted ? "" : "opacity-70"}>
                  <td className="py-3 pr-4 ad-text">{row.chapterName}</td>
                  <td className="py-3 pr-4 ad-text">{row.challengeTitle}</td>
                  <td className="py-3 pr-4 font-medium ad-text">{row.teamName}</td>
                  <td className="py-3 pr-4">
                    {row.submitted ? (
                      <span className="ad-text">{row.projectName}</span>
                    ) : (
                      <Badge variant="upcoming" light>
                        No submission
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {row.snapshot === null ? (
                      <span className="ad-text-muted">—</span>
                    ) : row.snapshot === "missing" ? (
                      <Badge variant="upcoming" light>
                        {snapshotStatusLabel(row.snapshot)}
                      </Badge>
                    ) : (
                      <span className="ad-text-muted">{snapshotStatusLabel(row.snapshot)}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 ad-text-muted">
                    {row.updatedAt ? formatDate(row.updatedAt) : "—"}
                  </td>
                  <td className="py-3">
                    {row.submissionId ? (
                      <Link
                        href={`/admin/submissions/${row.submissionId}`}
                        className="ad-text-link hover:underline"
                      >
                        View →
                      </Link>
                    ) : (
                      <span className="ad-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
