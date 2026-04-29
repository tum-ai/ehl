import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/admin/stats/stat-card";
import { DashboardCharts } from "@/components/admin/stats/dashboard-charts";
import {
  getTeams,
  getChaptersAdmin,
  getPartners,
  getSeasonStats,
} from "@/lib/queries";

export default async function AdminDashboard() {
  const [teams, chapters, partners, seasonStats] = await Promise.all([
    getTeams(),
    getChaptersAdmin(),
    getPartners(),
    getSeasonStats(),
  ]);

  const nextChapter = chapters.find((c) => c.status !== "completed");
  const pendingChapters = chapters.filter(
    (c) => c.status !== "completed" && c.status !== "draft"
  );

  return (
    <div>
      <h1 className="ad-title text-2xl">Dashboard</h1>
      <p className="mt-1 ad-text-secondary">Season 1 overview</p>

      {/* Core stats */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/teams">
          <StatCard label="Teams" value={teams.length} />
        </Link>
        <Link href="/admin/chapters">
          <StatCard
            label="Chapters"
            value={chapters.length}
            subtitle={`${seasonStats.seasonProgression.completed} completed`}
          />
        </Link>
        <StatCard
          label="Participants"
          value={seasonStats.totalParticipants}
          subtitle="Checked in across all chapters"
        />
        <Link href="/admin/partners">
          <StatCard label="Partners" value={partners.length} />
        </Link>
      </div>

      {/* Season metrics */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Applications"
          value={seasonStats.applicationFunnel.applied}
          subtitle={`${seasonStats.applicationFunnel.accepted} accepted`}
        />
        <StatCard
          label="Registrations"
          value={seasonStats.totalRegistrations}
          subtitle="Teams registered for challenges"
        />
        <StatCard
          label="Submissions"
          value={seasonStats.totalSubmissions}
          subtitle={`${seasonStats.applicationFunnel.submitted} unique teams`}
        />
      </div>

      {/* Charts */}
      <div className="mt-8">
        <DashboardCharts
          funnel={seasonStats.applicationFunnel}
          chapters={seasonStats.perChapter}
        />
      </div>

      {/* Next chapter */}
      {nextChapter && (
        <Link href={`/admin/chapters/${nextChapter.id}`}>
          <Card className="mt-8 transition-colors duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm ad-text-muted">Next match</p>
                <p className="ad-heading mt-1 text-lg">{nextChapter.name}</p>
                <p className="text-sm ad-text-secondary">
                  {nextChapter.city}, {nextChapter.country} &middot; Status:{" "}
                  <span className="font-medium ad-text-gold">{nextChapter.status}</span>
                </p>
              </div>
              <svg className="h-5 w-5 ad-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Card>
        </Link>
      )}

      {/* Upcoming matches */}
      {pendingChapters.length > 0 && (
        <div className="mt-8">
          <h2 className="ad-heading text-sm uppercase tracking-wider ad-text-muted">
            Upcoming Matches
          </h2>
          <div className="mt-4 space-y-2">
            {pendingChapters.map((chapter) => (
              <div
                key={chapter.id}
                className="flex items-center justify-between rounded-lg border ad-border px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full ad-bg-accent font-mono text-xs font-bold ad-text-link">
                    {chapter.matchNumber}
                  </span>
                  <div>
                    <p className="text-sm font-medium ad-text">{chapter.name}</p>
                    <p className="text-xs ad-text-muted">
                      {chapter.city}, {chapter.country}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full ad-bg-elevated px-2.5 py-1 text-xs ad-text-muted">
                    {chapter.status}
                  </span>
                  <Link
                    href={`/admin/chapters/${chapter.id}`}
                    className="rounded-lg ad-bg-accent px-3 py-1.5 text-xs font-medium ad-text-link transition-colors ad-bg-accent-hover"
                  >
                    Edit
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
