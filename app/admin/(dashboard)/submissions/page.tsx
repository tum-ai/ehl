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
    chapterName: string;
    challengeTitle: string;
    teamName: string;
    submitted: boolean;
    submissionId: string | null;
    projectName: string | null;
    updatedAt: string | null;
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
      chapterName: chapter?.name ?? "Unknown match",
      challengeTitle: challenge?.title ?? "Unknown challenge",
      teamName: teamName(s.teamId),
      submitted: true,
      submissionId: s.id,
      projectName: s.projectName,
      updatedAt: s.updatedAt,
    });
  }

  for (const r of registrations) {
    if (submittedKeys.has(`${r.challengeId}:${r.teamId}`)) continue;
    const challenge = challengeById.get(r.challengeId);
    const chapter = chapterFor(r.challengeId);
    rows.push({
      key: `reg:${r.id}`,
      chapterName: chapter?.name ?? "Unknown match",
      challengeTitle: challenge?.title ?? "Unknown challenge",
      teamName: teamName(r.teamId),
      submitted: false,
      submissionId: null,
      projectName: null,
      updatedAt: null,
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="ad-title text-2xl">Submissions</h1>
        <p className="mt-1 ad-text-secondary">
          {submittedCount} submitted, {missingCount} registered without a
          submission.
        </p>
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
                <th className="pb-3 pr-4 font-medium ad-text-muted">Updated</th>
                <th className="pb-3 font-medium ad-text-muted"></th>
              </tr>
            </thead>
            <tbody className="divide-y ad-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center ad-text-muted">
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
