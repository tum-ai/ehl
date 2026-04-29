import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateFull, getPlacementLabel } from "@/lib/utils";
import type { Chapter, Score, Team, Partner, MediaItem } from "@/lib/types";

interface ChapterCompletedProps {
  chapter: Chapter;
  scores: Score[];
  teams: Team[];
  partners: Partner[];
  photos?: MediaItem[];
}

const placementColors: Record<number, { text: string; border: string; bg: string }> = {
  1: { text: "text-gold", border: "border-l-gold/60", bg: "bg-gold/5" },
  2: { text: "text-silver", border: "border-l-silver/50", bg: "bg-silver/5" },
  3: { text: "text-bronze", border: "border-l-bronze/50", bg: "bg-bronze/5" },
};

export function ChapterCompleted({ chapter, scores, teams, partners, photos = [] }: ChapterCompletedProps) {
  const rankedScores = scores
    .filter((s) => s.placement !== null)
    .sort((a, b) => (a.placement || 99) - (b.placement || 99));

  const unrankedScores = scores.filter((s) => s.placement === null);
  const challenges = [...new Set(rankedScores.map((s) => s.challengeName))];

  const challengePartners = partners.filter((p) => p.tier === "challenge_partner");
  const techPartners = partners.filter((p) => p.tier === "tech_partner");

  const isMakeathon = chapter.slug === "munich-1";

  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className="glow-blob glow-blob-gold absolute -right-60 -top-40 h-[500px] w-[500px] opacity-10" />
      <div className="glow-blob glow-blob-purple absolute -left-40 top-1/3 h-[400px] w-[400px] opacity-10" />

      {/* Hero with event photo */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06]">
        {isMakeathon && (
          <div className="relative h-64 sm:h-80 lg:h-96">
            <Image
              src="/makeathon/audience.jpg"
              alt="Makeathon 2026, 500+ participants"
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-deep via-surface-deep/60 to-transparent" />
          </div>
        )}

        <div className={cn("relative p-8 sm:p-12", isMakeathon && "-mt-32 z-10")}>
          <Badge variant="completed">Completed</Badge>
          <h1 className="mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
            {chapter.name}
          </h1>
          <p className="mt-3 text-text-secondary">
            {chapter.city}, {chapter.country} &middot; {formatDateFull(chapter.date, chapter.dateEnd)}
          </p>
          <p className="mt-4 max-w-2xl font-hero-body leading-relaxed text-text-secondary">
            {chapter.description}
          </p>

          {/* Quick stats with glow */}
          {isMakeathon && (
            <div className="mt-6 flex flex-wrap gap-6">
              {[
                { label: "Participants", value: "500+" },
                { label: "Teams", value: "101" },
                { label: "Challenges", value: "4" },
                { label: "Hours", value: "48" },
              ].map((stat) => (
                <div key={stat.label} className="relative">
                  <p className="font-mono text-2xl font-black text-gold drop-shadow-[0_0_8px_rgba(255,204,106,0.3)]">{stat.value}</p>
                  <p className="text-xs text-text-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Challenge Partners */}
      {challengePartners.length > 0 && (
        <div className="mt-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold/30" />
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
              Challenge Partners
            </h2>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold/30" />
          </div>
          <div className="flex flex-wrap items-center gap-8">
            {challengePartners.map((partner) => (
              <a
                key={partner.id}
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group transition-all duration-300 hover:drop-shadow-[0_0_12px_rgba(255,204,106,0.2)]"
                title={partner.name}
              >
                <Image
                  src={partner.logoUrl}
                  alt={partner.name}
                  width={120}
                  height={40}
                  className="h-10 w-auto object-contain opacity-70 transition-opacity duration-300 group-hover:opacity-100"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Tech Partners */}
      {techPartners.length > 0 && (
        <div className="mt-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
              Tech Partners
            </h2>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-purple/30" />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {techPartners.map((partner) => (
              <a
                key={partner.id}
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group transition-all duration-300 hover:drop-shadow-[0_0_12px_rgba(154,100,217,0.2)]"
                title={partner.name}
              >
                <Image
                  src={partner.logoUrl}
                  alt={partner.name}
                  width={100}
                  height={40}
                  className="h-10 w-auto object-contain opacity-50 transition-opacity duration-300 group-hover:opacity-100"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Results by challenge */}
      <div className="mt-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
            Results by Challenge
          </h2>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-purple/30" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {challenges.map((challenge) => {
            const challengeScores = rankedScores.filter((s) => s.challengeName === challenge);
            return (
              <div key={challenge} className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 transition-all duration-500 hover:border-purple/20">
                {/* Corner accents */}
                <div className="absolute top-0 left-0 h-8 w-px bg-gradient-to-b from-purple/30 to-transparent" />
                <div className="absolute top-0 left-0 h-px w-8 bg-gradient-to-r from-purple/30 to-transparent" />
                <div className="absolute bottom-0 right-0 h-8 w-px bg-gradient-to-t from-purple/30 to-transparent" />
                <div className="absolute bottom-0 right-0 h-px w-8 bg-gradient-to-l from-purple/30 to-transparent" />

                <h3 className="mb-4 font-hero-heading text-lg font-bold text-purple-light">{challenge}</h3>
                <div className="space-y-2">
                  {challengeScores.map((score) => {
                    const team = teams.find((t) => t.id === score.teamId);
                    if (!team) return null;
                    const colors = placementColors[score.placement!];

                    return (
                      <div
                        key={score.teamId}
                        className={cn(
                          "flex items-center justify-between rounded-xl border border-white/[0.04] px-4 py-3 transition-colors duration-200 hover:bg-white/[0.02]",
                          colors ? `border-l-4 ${colors.border} ${colors.bg}` : "bg-white/[0.02]"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className={cn("w-8 font-mono text-sm font-black", colors?.text || "text-text-muted")}>
                            {getPlacementLabel(score.placement!)}
                          </span>
                          <span className="font-medium">{team.name}</span>
                        </div>
                        <span className="font-mono font-bold text-gold">
                          +{score.points}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Participants */}
      {unrankedScores.length > 0 && (
        <div className="mt-10">
          <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
            Participants ({unrankedScores.length} teams)
          </h3>
          <div className="flex flex-wrap gap-2">
            {unrankedScores.map((score) => {
              const team = teams.find((t) => t.id === score.teamId);
              if (!team) return null;
              return (
                <span
                  key={score.teamId}
                  className="rounded-lg border border-white/[0.06] bg-surface-card/40 px-3 py-1.5 text-sm text-text-secondary transition-colors duration-200 hover:border-white/10 hover:bg-surface-card"
                >
                  {team.name}{" "}
                  <span className="font-mono text-gold/50">+{score.points}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Photo Gallery */}
      {photos.length > 0 && (
        <div className="mt-12">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
              Photos
            </h2>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-purple/30" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((photo) => (
              <a
                key={photo.id}
                href={`https://drive.google.com/file/d/${photo.url}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.06] transition-all duration-300 hover:border-purple/20 hover:shadow-[0_0_20px_rgba(154,100,217,0.1)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://lh3.googleusercontent.com/d/${photo.url}=w400`}
                  alt={photo.caption || "Match photo"}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
                {photo.caption && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="text-xs text-white">{photo.caption}</p>
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Photo Album Link (fallback for external albums) */}
      {chapter.photoAlbumUrl && photos.length === 0 && (
        <div className="mt-12">
          <a
            href={chapter.photoAlbumUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 rounded-xl border border-purple/20 bg-purple/5 px-6 py-4 transition-all duration-300 hover:border-purple/40 hover:bg-purple/10"
          >
            <svg className="h-6 w-6 text-purple-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
            <div>
              <p className="text-sm font-bold text-text-primary group-hover:text-purple-light transition-colors">
                View Photo Album
              </p>
              <p className="text-xs text-text-muted">Google Drive</p>
            </div>
            <svg className="h-4 w-4 text-text-muted transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}
