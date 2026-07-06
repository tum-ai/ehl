"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useInView } from "framer-motion";
import { LimitBanner } from "@/components/ui/limit-banner";
import { SectionTitle } from "@/components/ui/section";
import { GlassPillar } from "@/components/podium/GlassPillar";
import { RANK_COLORS } from "@/lib/design-tokens";
import { cn, formatDateFull, getPlacementLabel, getPlacementColor } from "@/lib/utils";
import { driveThumbnailUrl, drivePhotoViewUrl } from "@/lib/drive-urls";
import { rankingSupportsPodium } from "@/lib/showcase-shared";
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
  ranking: ShowcaseRankingRow[];
  rankingTruncated: boolean;
  photos: MediaItem[];
  photosTruncated: boolean;
  // Server-computed query limits: the client must not import QUERY_LIMITS
  // (env-var backed, not inlined into the client bundle), or SSR and hydration
  // disagree whenever a LIMIT_* override is set.
  limits: { applicants: number; photos: number };
}

type Filter = "all" | "participated" | "with_cv";

const PODIUM_HEIGHTS: Record<number, string> = {
  1: "h-36 sm:h-44",
  2: "h-24 sm:h-32",
  3: "h-16 sm:h-24",
};

export function ShowcaseView({
  token,
  showCvs,
  chapter,
  applicants,
  applicantsTruncated,
  ranking,
  rankingTruncated,
  photos,
  photosTruncated,
  limits,
}: ShowcaseViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Photo selection: a set of selected Drive fileIds (photo.url). Empty set =
  // nothing selected; the "Download all" button downloads the whole gallery,
  // "Download selected" downloads the chosen ids. Selection mode is off until
  // the user turns it on, so the gallery stays a clean lightbox grid by default.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);

  const togglePhoto = (fileId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  // Max photos per ZIP request. A full-resolution photo takes ~1.35s to fetch
  // from Drive; the route's timeout is 300s, so 100 per batch (~135s) leaves
  // comfortable headroom. Larger albums are downloaded as several sequential
  // ZIPs (see downloadPhotos), so "Download all" works at any album size.
  const PHOTO_BATCH_SIZE = 100;

  // Fetch one ZIP for an explicit list of fileIds and trigger a save. The route
  // is POST (it takes a body of fileIds) and returns a validated archive, so it
  // can't be a plain <a href>. Returns true on success. suffix distinguishes the
  // files when an album is split across batches (ehl-photos-1.zip, -2.zip).
  // Returns null on success, or the error message on failure (so the caller can
  // compose a multi-batch message without reading back React state mid-loop).
  const fetchPhotoZip = async (fileIds: string[], suffix: string): Promise<string | null> => {
    const res = await fetch(`/api/showcase/${encodeURIComponent(token)}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ fileIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return data?.error || "Download failed. Please try again.";
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ehl-photos${suffix}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return null;
  };

  // Download the given photos as ZIP(s). An album larger than one batch is split
  // into several sequential ZIPs so no single request risks the function
  // timeout; the user gets one file per batch. Progress is surfaced so a
  // multi-file download never looks stuck.
  const downloadPhotos = async (fileIds: string[]) => {
    if (downloading || fileIds.length === 0) return;
    setDownloading(true);
    setDownloadError(null);
    setDownloadProgress(null);
    try {
      const batches: string[][] = [];
      for (let i = 0; i < fileIds.length; i += PHOTO_BATCH_SIZE) {
        batches.push(fileIds.slice(i, i + PHOTO_BATCH_SIZE));
      }
      for (let b = 0; b < batches.length; b++) {
        if (batches.length > 1) setDownloadProgress(`Preparing ZIP ${b + 1} of ${batches.length}...`);
        const suffix = batches.length > 1 ? `-${b + 1}` : "";
        const err = await fetchPhotoZip(batches[b], suffix);
        if (err) {
          // For a multi-batch run, tell the user which parts they DID get so a
          // partial download isn't mistaken for a total failure.
          setDownloadError(
            batches.length > 1 && b > 0
              ? `Downloaded ${b} of ${batches.length} ZIP files, then stopped: ${err} You can retry to get the rest.`
              : err
          );
          return;
        }
      }
    } catch {
      setDownloadError("Download failed. Please check your connection and try again.");
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  // "Download all" sends every visible photo's fileId (batched by downloadPhotos),
  // so it works regardless of album size instead of hitting the route's per-ZIP cap.
  const allFileIds = useMemo(() => photos.map((p) => p.url), [photos]);

  const participantCount = useMemo(
    () => applicants.filter((a) => a.checkedIn).length,
    [applicants]
  );
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
      const hay = `${a.firstName} ${a.lastName} ${a.teamName ?? ""} ${a.linkedIn ?? ""} ${a.github ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [applicants, query, filter, showCvs]);

  const placedRows = ranking.filter((r) => r.placement !== null);
  const participatedRows = ranking.filter((r) => r.placement === null);
  const challengeCount = new Set(placedRows.map((r) => r.challengeName)).size;

  // Placements are assigned PER CHALLENGE, so a multi-challenge chapter has
  // several placement=1 rows. The podium can only represent unique placements —
  // keying by placement would silently drop a winning team. When placements are
  // not unique, every placed row renders in the (challenge-labeled) list.
  const podiumApplies = rankingSupportsPodium(placedRows);
  const podiumRows = podiumApplies ? placedRows.filter((r) => r.placement! <= 3) : [];
  const listRows = podiumApplies ? placedRows.filter((r) => r.placement! > 3) : placedRows;

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient glow */}
      <div className="glow-blob glow-blob-gold animate-glow-pulse pointer-events-none absolute -right-60 -top-40 h-[500px] w-[500px] opacity-20" />
      <div
        className="glow-blob glow-blob-purple animate-glow-pulse pointer-events-none absolute -left-40 top-1/3 h-[400px] w-[400px] opacity-20"
        style={{ animationDelay: "2s" }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        {/* ── Hero ──────────────────────────────────────────── */}
        <header className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40">
          {chapter?.heroImageUrl && (
            <div className="relative h-52 sm:h-64 lg:h-72">
              <Image
                src={chapter.heroImageUrl}
                alt={chapter.name}
                fill
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface-deep via-surface-deep/60 to-transparent" />
            </div>
          )}

          <div className={cn("relative p-8 sm:p-12", chapter?.heroImageUrl && "-mt-24 z-10")}>
            {/* Corner brackets */}
            <div className="pointer-events-none absolute left-0 top-0 h-10 w-px bg-gradient-to-b from-purple/40 to-transparent" />
            <div className="pointer-events-none absolute left-0 top-0 h-px w-10 bg-gradient-to-r from-purple/40 to-transparent" />
            <div className="pointer-events-none absolute bottom-0 right-0 h-10 w-px bg-gradient-to-t from-gold/30 to-transparent" />
            <div className="pointer-events-none absolute bottom-0 right-0 h-px w-10 bg-gradient-to-l from-gold/30 to-transparent" />

            <div className="animate-fade-in flex flex-wrap items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold/90">
                Partner Showcase
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-gold/70" />
                Confidential
              </span>
            </div>

            <h1
              className="animate-fade-in-up mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl"
              style={{ animationDelay: "0.1s" }}
            >
              {chapter?.name ?? "Hackathon"}
            </h1>
            {chapter && (
              <p
                className="animate-fade-in-up mt-3 text-text-secondary"
                style={{ animationDelay: "0.2s" }}
              >
                {chapter.city}, {chapter.country}
                {chapter.date && (
                  <> &middot; {formatDateFull(chapter.date, chapter.dateEnd)}</>
                )}
              </p>
            )}

            {/* Stat strip */}
            <div
              className="animate-fade-in-up mt-8 flex flex-wrap gap-8"
              style={{ animationDelay: "0.3s" }}
            >
              <Stat value={applicants.length} label="Applicants" />
              <Stat value={participantCount} label="Participated" />
              {showCvs && <Stat value={cvCount} label="CVs available" />}
              {ranking.length > 0 && <Stat value={ranking.length} label="Teams" />}
            </div>
          </div>
        </header>

        {/* ── Final Ranking ─────────────────────────────────── */}
        {ranking.length > 0 && (
          <section className="mt-16">
            <SectionTitle align="left">Final Ranking</SectionTitle>

            {rankingTruncated && (
              <div className="mb-4">
                <LimitBanner count={ranking.length} limit={ranking.length} label="ranked teams" />
              </div>
            )}

            {podiumRows.length > 0 && <ShowcasePodium rows={podiumRows} />}

            {listRows.length > 0 && (
              <div className={cn("space-y-2", podiumRows.length > 0 && "mt-8")}>
                {listRows.map((row) => (
                  <div
                    key={`${row.teamId}-${row.challengeName}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-5 py-4 transition-colors duration-200 hover:bg-white/[0.04]"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span
                        className={cn(
                          "w-10 shrink-0 font-mono text-sm font-black",
                          row.placement! <= 3 ? getPlacementColor(row.placement!) : "text-text-muted"
                        )}
                      >
                        {getPlacementLabel(row.placement!)}
                      </span>
                      <span className="truncate font-medium">{row.teamName}</span>
                      {challengeCount > 1 && (
                        <span className="hidden shrink-0 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted sm:inline-block">
                          {row.challengeName}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono font-bold text-gold">+{row.points}</span>
                  </div>
                ))}
              </div>
            )}

            {participatedRows.length > 0 && (
              <div className="mt-8">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
                  Participating Teams ({participatedRows.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {participatedRows.map((row) => (
                    <span
                      key={row.teamId}
                      className="rounded-lg border border-white/[0.06] bg-surface-card/40 px-3 py-1.5 text-sm text-text-secondary transition-colors duration-200 hover:border-white/10"
                    >
                      {row.teamName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Applicants ────────────────────────────────────── */}
        <section className="mt-16">
          <SectionTitle align="left">Applicants</SectionTitle>

          {/* Search + filter toolbar */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, team, LinkedIn, GitHub"
                className="w-full rounded-xl border border-white/[0.08] bg-surface-card/60 py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-purple/40 focus:outline-none focus:ring-1 focus:ring-purple/30"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              {showCvs && cvCount > 0 && (
                <a
                  href={`/api/showcase/${encodeURIComponent(token)}/cvs`}
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-all hover:bg-gold/20 hover:shadow-[0_0_12px_rgba(255,204,106,0.15)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download all CVs ({cvCount})
                </a>
              )}
            </div>
          </div>

          {applicantsTruncated && (
            <div className="mb-4">
              {/* count=limit: the flag is server-computed pre-filter, so the
                  banner must not depend on the post-filter array length. */}
              <LimitBanner count={limits.applicants} limit={limits.applicants} label="applicants" />
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 px-5 py-12 text-center">
              <p className="text-sm text-text-muted">No applicants match your search.</p>
              {(query || filter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                  className="mt-3 text-xs font-semibold text-purple-light transition-colors hover:text-purple"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => (
                <ApplicantCard key={a.id} applicant={a} token={token} showCvs={showCvs} />
              ))}
            </div>
          )}
        </section>

        {/* ── Photos ────────────────────────────────────────── */}
        {photos.length > 0 && (
          <section className="mt-16">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle align="left">Photos</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                {selecting ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((prev) =>
                          prev.size === photos.length
                            ? new Set()
                            : new Set(photos.map((p) => p.url))
                        )
                      }
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-text-secondary transition-all hover:border-white/20 hover:text-white"
                    >
                      {selected.size === photos.length ? "Deselect all" : "Select all"}
                    </button>
                    <button
                      type="button"
                      disabled={downloading || selected.size === 0}
                      onClick={() =>
                        downloadPhotos(photos.map((p) => p.url).filter((id) => selected.has(id)))
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-all hover:bg-gold/20 hover:shadow-[0_0_12px_rgba(255,204,106,0.15)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <DownloadIcon />
                      {downloading
                        ? downloadProgress ?? "Preparing..."
                        : `Download selected (${selected.size})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelecting(false);
                        setSelected(new Set());
                        setDownloadError(null);
                      }}
                      className="rounded-lg px-3 py-2 text-xs font-semibold text-text-muted transition-colors hover:text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelecting(true)}
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-text-secondary transition-all hover:border-white/20 hover:text-white"
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      disabled={downloading}
                      onClick={() => downloadPhotos(allFileIds)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-all hover:bg-gold/20 hover:shadow-[0_0_12px_rgba(255,204,106,0.15)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <DownloadIcon />
                      {downloading
                        ? downloadProgress ?? "Preparing..."
                        : `Download all (${photos.length})`}
                    </button>
                  </>
                )}
              </div>
            </div>
            {downloadError && (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {downloadError}
              </p>
            )}
            {photosTruncated && (
              <div className="mb-4 mt-4">
                <LimitBanner count={limits.photos} limit={limits.photos} label="photos" />
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 [grid-auto-flow:dense]">
              {photos.map((photo, i) => {
                const feature = i === 0 && photo.featured;
                const isSelected = selected.has(photo.url);
                const commonClass = cn(
                  "group relative block overflow-hidden rounded-xl border transition-all duration-300",
                  isSelected
                    ? "border-gold/60 shadow-[0_0_20px_rgba(255,204,106,0.25)]"
                    : "border-white/[0.06] hover:border-purple/25 hover:shadow-[0_0_24px_rgba(154,100,217,0.15)]",
                  feature ? "col-span-2 row-span-2 aspect-square sm:aspect-auto" : "aspect-square"
                );
                const inner = (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={driveThumbnailUrl(photo.url, feature ? 800 : 400)}
                      alt={photo.caption || "Event photo"}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    {selecting && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all",
                          isSelected
                            ? "border-gold bg-gold text-surface-deep"
                            : "border-white/70 bg-black/40 text-transparent"
                        )}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </span>
                    )}
                    {photo.caption && !selecting && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <p className="text-xs text-white">{photo.caption}</p>
                      </div>
                    )}
                  </>
                );

                // In selection mode the tile is a toggle button (aria-pressed);
                // otherwise it is a link that opens the full photo in a new tab.
                return selecting ? (
                  <button
                    key={photo.id}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={isSelected ? "Deselect photo" : "Select photo"}
                    onClick={() => togglePhoto(photo.url)}
                    className={cn(commonClass, "cursor-pointer text-left")}
                  >
                    {inner}
                  </button>
                ) : (
                  <a
                    key={photo.id}
                    href={drivePhotoViewUrl(photo.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className={commonClass}
                  >
                    {inner}
                  </a>
                );
              })}
            </div>
          </section>
        )}

        <footer className="mt-20 border-t border-white/[0.06] pt-6 text-center text-xs text-text-muted">
          Shared by European Hackathon League. This page and its data are
          confidential and intended for the recipient partner only.
        </footer>
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

// ── Podium (top 3, glass pillars) ─────────────────────────────

function ShowcasePodium({ rows }: { rows: ShowcaseRankingRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });

  // Visual order 2nd, 1st, 3rd; render only the placements that exist.
  const byPlacement = new Map(rows.map((r) => [r.placement!, r]));
  const order = [2, 1, 3].filter((p) => byPlacement.has(p));

  return (
    <div ref={ref} className="flex items-end justify-center gap-2 sm:gap-5">
      {order.map((placement, i) => {
        const row = byPlacement.get(placement)!;
        return (
          <div key={row.teamId} className="min-w-0 flex-1 sm:max-w-[200px]">
            <GlassPillar
              rank={placement}
              teamName={row.teamName}
              points={row.points}
              color={RANK_COLORS[placement]}
              height={PODIUM_HEIGHTS[placement]}
              delay={i * 0.12}
              isInView={isInView}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="relative">
      <p className="font-mono text-2xl font-black text-gold drop-shadow-[0_0_8px_rgba(255,204,106,0.25)]">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
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
        "rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-200",
        active
          ? "border-purple/40 bg-purple/10 text-purple-light shadow-[0_0_12px_rgba(154,100,217,0.15)]"
          : "border-white/[0.08] bg-surface-card/40 text-text-secondary hover:border-white/15"
      )}
    >
      {children}
    </button>
  );
}

// Applicant-supplied profile URLs are free text. The apply form doesn't enforce
// a scheme, so "linkedin.com/in/jane" is common: prefix https:// for host-like
// values (mirroring the admin view), then still allow ONLY http(s) so a stored
// javascript:/data: value can never render as a clickable link. Returns a safe
// href or null.
function safeHttpUrl(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  try {
    const u = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // A prefixed value must at least look like a hostname, or free text like
    // "N/A" would turn into a garbage link.
    if (!hasScheme && !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

const AVATAR_GRADIENTS = [
  "from-purple/50 to-purple-dark/60",
  "from-gold/40 to-gold-dark/50",
  "from-purple/45 to-gold/35",
  "from-ci-lavender/45 to-purple-dark/55",
  "from-gold/35 to-purple/45",
];

function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
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
  const fullName = `${applicant.firstName} ${applicant.lastName}`;
  const initials = `${applicant.firstName[0] ?? ""}${applicant.lastName[0] ?? ""}`.toUpperCase();
  const linkedInHref = safeHttpUrl(applicant.linkedIn);
  const githubHref = safeHttpUrl(applicant.github);
  const linkedInUser = linkedInHref ? extractLinkedInUsername(linkedInHref) : null;
  const githubUser = githubHref ? extractGitHubUsername(githubHref) : null;
  const cvHref = `/api/showcase/${encodeURIComponent(token)}/cv/${encodeURIComponent(applicant.id)}`;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-purple/25 hover:shadow-[0_4px_24px_rgba(154,100,217,0.12)]">
      {/* Corner accent */}
      <div className="pointer-events-none absolute right-0 top-0 h-8 w-px bg-gradient-to-b from-purple/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="pointer-events-none absolute right-0 top-0 h-px w-8 bg-gradient-to-l from-purple/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-hero-heading text-sm font-bold text-white/90 ring-1 ring-white/10",
            avatarGradient(fullName)
          )}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-hero-heading text-lg font-bold leading-tight" title={fullName}>
            {fullName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                badge.className
              )}
            >
              {badge.label}
            </span>
            {applicant.teamName && (
              <span
                className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-purple/25 bg-purple/10 px-2 py-0.5 text-[10px] font-semibold text-purple-light"
                title={`Team: ${applicant.teamName}`}
              >
                <svg className="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                <span className="truncate">{applicant.teamName}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {linkedInHref && (
          <a
            href={linkedInHref}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-[#0A66C2]/50 hover:text-[#4d94e8]"
          >
            <span className="font-bold">in</span>
            <span className="truncate">{linkedInUser ? `/${linkedInUser}` : "LinkedIn"}</span>
          </a>
        )}
        {githubHref && (
          <a
            href={githubHref}
            target="_blank"
            rel="noreferrer noopener"
            referrerPolicy="no-referrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-white/25 hover:text-text-primary"
          >
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="truncate">{githubUser ?? "GitHub"}</span>
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
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-all hover:bg-gold/20 hover:shadow-[0_0_12px_rgba(255,204,106,0.15)]"
              >
                View CV
              </a>
              <a
                href={`${cvHref}?download=1`}
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
