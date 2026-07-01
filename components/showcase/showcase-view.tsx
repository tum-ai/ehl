"use client";

import { useMemo, useState } from "react";
import { LimitBanner } from "@/components/ui/limit-banner";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { cn, formatDateFull, getPlacementLabel } from "@/lib/utils";
import { extractLinkedInUsername, extractGitHubUsername } from "@/lib/flag-utils";
import type { Chapter, MediaItem } from "@/lib/types";
import type {
  ShowcaseApplicant,
  ShowcaseRankingRow,
} from "@/lib/queries/showcase";

interface ShowcaseViewProps {
  token: string;
  showCvs: boolean;
  chapter: Chapter | null;
  applicants: ShowcaseApplicant[];
  applicantsTruncated: boolean;
  participantCount: number;
  ranking: ShowcaseRankingRow[];
  photos: MediaItem[];
  photosTruncated: boolean;
}

const placementColors: Record<number, { text: string; border: string; bg: string }> = {
  1: { text: "text-gold", border: "border-l-gold/60", bg: "bg-gold/5" },
  2: { text: "text-silver", border: "border-l-silver/50", bg: "bg-silver/5" },
  3: { text: "text-bronze", border: "border-l-bronze/50", bg: "bg-bronze/5" },
};

type Filter = "all" | "participated" | "with_cv";

export function ShowcaseView({
  token,
  showCvs,
  chapter,
  applicants,
  applicantsTruncated,
  participantCount,
  ranking,
  photos,
  photosTruncated,
}: ShowcaseViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const cvCount = useMemo(
    () => applicants.filter((a) => a.hasCv).length,
    [applicants]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applicants.filter((a) => {
      if (filter === "participated" && !a.checkedIn) return false;
      if (filter === "with_cv" && !(showCvs && a.hasCv)) return false;
      if (!q) return true;
      const hay = `${a.firstName} ${a.lastName} ${a.linkedIn ?? ""} ${a.github ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [applicants, query, filter, showCvs]);

  const rankedRows = ranking.filter((r) => r.placement !== null);
  const participatedRows = ranking.filter((r) => r.placement === null);

  return (
    <div className="relative min-h-screen">
      {/* Ambient glow */}
      <div className="glow-blob glow-blob-gold pointer-events-none absolute -right-60 -top-40 h-[500px] w-[500px] opacity-10" />
      <div className="glow-blob glow-blob-purple pointer-events-none absolute -left-40 top-1/3 h-[400px] w-[400px] opacity-10" />

      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-8 sm:p-12">
          <div className="absolute top-0 left-0 h-10 w-px bg-gradient-to-b from-purple/30 to-transparent" />
          <div className="absolute top-0 left-0 h-px w-10 bg-gradient-to-r from-purple/30 to-transparent" />
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold/80">
            Partner Showcase
          </p>
          <h1 className="mt-3 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
            {chapter?.name ?? "Hackathon"}
          </h1>
          {chapter && (
            <p className="mt-3 text-text-secondary">
              {chapter.city}, {chapter.country}
              {chapter.date && (
                <> &middot; {formatDateFull(chapter.date, chapter.dateEnd)}</>
              )}
            </p>
          )}

          {/* Stat strip */}
          <div className="mt-8 flex flex-wrap gap-8">
            <Stat value={applicants.length} label="Applicants" />
            <Stat value={participantCount} label="Participated" />
            {showCvs && <Stat value={cvCount} label="CVs available" />}
            {rankedRows.length > 0 && (
              <Stat value={ranking.length} label="Teams" />
            )}
          </div>
        </header>

        {/* Ranking */}
        {ranking.length > 0 && (
          <section className="mt-14">
            <DividerHeading>Final Ranking</DividerHeading>
            {rankedRows.length > 0 && (
              <div className="space-y-2">
                {rankedRows.map((row) => {
                  const colors = row.placement ? placementColors[row.placement] : undefined;
                  return (
                    <div
                      key={row.teamId}
                      className={cn(
                        "flex items-center justify-between rounded-xl border border-white/[0.04] px-5 py-4 transition-colors duration-200 hover:bg-white/[0.02]",
                        colors ? `border-l-4 ${colors.border} ${colors.bg}` : "bg-white/[0.02]"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <span className={cn("w-10 font-mono text-sm font-black", colors?.text ?? "text-text-muted")}>
                          {getPlacementLabel(row.placement!)}
                        </span>
                        <span className="font-medium">{row.teamName}</span>
                      </div>
                      <span className="font-mono font-bold text-gold">+{row.points}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {participatedRows.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
                  Participating Teams ({participatedRows.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {participatedRows.map((row) => (
                    <span
                      key={row.teamId}
                      className="rounded-lg border border-white/[0.06] bg-surface-card/40 px-3 py-1.5 text-sm text-text-secondary"
                    >
                      {row.teamName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Applicants */}
        <section className="mt-14">
          <DividerHeading>Applicants</DividerHeading>

          {/* Search + filter toolbar */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, LinkedIn, GitHub"
              className="w-full rounded-xl border border-white/[0.08] bg-surface-card/60 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-purple/40 focus:outline-none sm:max-w-xs"
            />
            <div className="flex gap-2">
              <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
                All ({applicants.length})
              </FilterPill>
              <FilterPill active={filter === "participated"} onClick={() => setFilter("participated")}>
                Participated ({participantCount})
              </FilterPill>
              {showCvs && (
                <FilterPill active={filter === "with_cv"} onClick={() => setFilter("with_cv")}>
                  With CV ({cvCount})
                </FilterPill>
              )}
            </div>
          </div>

          {applicantsTruncated && (
            <div className="mb-4">
              <LimitBanner
                count={applicants.length}
                limit={QUERY_LIMITS.applicationsPerChapter}
                label="applicants"
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] bg-surface-card/40 px-5 py-8 text-center text-sm text-text-muted">
              No applicants match your search.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <ApplicantCard key={a.id} applicant={a} token={token} showCvs={showCvs} />
              ))}
            </div>
          )}
        </section>

        {/* Photos */}
        {photos.length > 0 && (
          <section className="mt-14">
            <DividerHeading>Photos</DividerHeading>
            {photosTruncated && (
              <div className="mb-4">
                <LimitBanner count={photos.length} limit={QUERY_LIMITS.media} label="photos" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => (
                <a
                  key={photo.id}
                  href={`https://drive.google.com/file/d/${photo.url}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.06] transition-all duration-300 hover:border-purple/20 hover:shadow-[0_0_20px_rgba(154,100,217,0.1)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://lh3.googleusercontent.com/d/${photo.url}=w400`}
                    alt={photo.caption || "Event photo"}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 border-t border-white/[0.06] pt-6 text-center text-xs text-text-muted">
          Shared by European Hackathon League. This page and its data are
          confidential and intended for the recipient partner only.
        </footer>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="relative">
      <p className="font-mono text-2xl font-black text-gold drop-shadow-[0_0_8px_rgba(255,204,106,0.25)]">
        {value}
      </p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

function DividerHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
        {children}
      </h2>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-purple/10" />
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2 text-xs font-medium transition-colors duration-200",
        active
          ? "border-purple/40 bg-purple/10 text-purple-light"
          : "border-white/[0.08] bg-surface-card/40 text-text-secondary hover:border-white/15"
      )}
    >
      {children}
    </button>
  );
}

const statusLabels: Record<ShowcaseApplicant["status"], { label: string; className: string }> = {
  participated: { label: "Participated", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  accepted: { label: "Accepted", className: "border-purple/30 bg-purple/10 text-purple-light" },
  applied: { label: "Applied", className: "border-white/10 bg-white/[0.03] text-text-muted" },
};

function ApplicantCard({
  applicant,
  token,
  showCvs,
}: {
  applicant: ShowcaseApplicant;
  token: string;
  showCvs: boolean;
}) {
  const badge = statusLabels[applicant.status];
  const linkedInUser = applicant.linkedIn ? extractLinkedInUsername(applicant.linkedIn) : null;
  const githubUser = applicant.github ? extractGitHubUsername(applicant.github) : null;
  const cvHref = `/api/showcase/${encodeURIComponent(token)}/cv/${encodeURIComponent(applicant.id)}`;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-5 transition-all duration-300 hover:border-purple/20">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-hero-heading text-lg font-bold leading-tight">
          {applicant.firstName} {applicant.lastName}
        </h3>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", badge.className)}>
          {badge.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {applicant.linkedIn && (
          <a
            href={applicant.linkedIn}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-[#0A66C2]/50 hover:text-[#4d94e8]"
          >
            <span className="font-bold">in</span>
            {linkedInUser ? `/${linkedInUser}` : "LinkedIn"}
          </a>
        )}
        {applicant.github && (
          <a
            href={applicant.github}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-white/25 hover:text-text-primary"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {githubUser ?? "GitHub"}
          </a>
        )}
      </div>

      {showCvs && (
        <div className="mt-auto pt-4">
          {applicant.hasCv ? (
            <div className="flex gap-2">
              <a
                href={cvHref}
                target="_blank"
                rel="noreferrer noopener"
                referrerPolicy="no-referrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
              >
                View CV
              </a>
              <a
                href={`${cvHref}?download=1`}
                download
                referrerPolicy="no-referrer"
                className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-text-secondary transition-colors hover:border-white/20 hover:text-text-primary"
                title="Download CV"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </a>
            </div>
          ) : (
            <p className="text-xs text-text-muted">No CV provided</p>
          )}
        </div>
      )}
    </div>
  );
}
