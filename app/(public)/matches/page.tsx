import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { CityIcon } from "@/components/ui/city-icon";
import { TimelineScrollHighlight } from "@/components/chapter/TimelineScrollHighlight";
import { getChapters, getPartners } from "@/lib/queries";
import { formatDateRange, cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Matches",
  description: "The Tour: 6 matches across Europe",
};

const statusBadgeVariant: Record<string, "completed" | "announced" | "upcoming"> = {
  completed: "completed",
  announced: "announced",
  applications_open: "announced",
  screening: "announced",
  registration_open: "announced",
  draft: "upcoming",
};

const statusLabel: Record<string, string> = {
  applications_open: "Applications Open",
  screening: "Preparation",
  registration_open: "Challenge Selection",
};

export default async function ChaptersPage() {
  const [chapters, allPartners] = await Promise.all([
    getChapters(),
    getPartners(),
  ]);

  return (
    <Section className="relative overflow-hidden">
      {/* Noise texture */}
      <div className="noise absolute inset-0" />

      <div className="glow-blob glow-blob-purple absolute -right-40 -top-20 h-[400px] w-[400px] opacity-15" />
      <div className="glow-blob glow-blob-gold absolute -left-40 top-2/3 h-[300px] w-[300px] opacity-10" />

      <div className="relative mb-16 text-center">
        <h1 className="font-hero-display text-4xl font-black sm:text-5xl">
          <span className="shimmer-text">The Tour</span>
        </h1>
        <p className="mt-3 font-hero-body text-text-secondary">
          6 hackathon matches across Europe
        </p>
      </div>

      {/* Vertical timeline with per-segment lines */}
      <div className="relative mx-auto max-w-3xl space-y-6 md:space-y-0">
        {chapters.map((chapter, i) => {
          const isCompleted = chapter.status === "completed";
          const isApplicationsOpen = chapter.status === "applications_open";
          const isFinale = chapter.isFinale;
          const isLast = i === chapters.length - 1;
          const nextIsFinale = !isLast && chapters[i + 1].isFinale;
          const chapterPartners = allPartners.filter((p) => p.chapterId === chapter.id);
          const heroImage = chapter.heroImageUrl || (chapter.slug === "munich-1" ? "/makeathon/audience.jpg" : null);

          return (
            <TimelineScrollHighlight key={chapter.id}>
            <div className="relative md:mb-12 md:last:mb-0">
              {/* Line segment from this node to next */}
              {!isLast && (
                <div
                  className={cn(
                    "absolute w-[2px] -translate-x-px",
                    "left-[24px] md:left-1/2",
                    isFinale ? "top-[52px]" : "top-[48px]",
                  )}
                  style={{ height: "calc(100% - 4px)" }}
                >
                  {nextIsFinale ? (
                    <div className="h-full border-l-2 border-dashed border-gold/25" />
                  ) : (
                    <div className="h-full bg-gradient-to-b from-purple/30 to-purple/15" />
                  )}
                </div>
              )}

              {/* Node + card row */}
              <div className={cn(
                "relative flex items-start gap-6",
                "md:gap-0"
              )}>
                {/* Timeline node */}
                <div className={cn(
                  "relative z-10 shrink-0",
                  "md:absolute md:left-1/2 md:-translate-x-1/2"
                )}>
                  {/* Glow ring: from status */}
                  {(isCompleted || isFinale) && (
                    <div className={cn(
                      "absolute inset-0 animate-glow-pulse rounded-full blur-md",
                      isFinale ? "bg-gold/25" : "bg-gold/20"
                    )} />
                  )}
                  {isApplicationsOpen && (
                    <div className="absolute inset-0 animate-glow-pulse rounded-full bg-green-400/20 blur-md" />
                  )}
                  {/* Scroll-active glow (CSS-driven via parent data attribute) */}
                  {!isCompleted && !isFinale && !isApplicationsOpen && (
                    <div className="timeline-scroll-glow absolute inset-0 rounded-full bg-purple/30 blur-md opacity-0 transition-opacity duration-500" />
                  )}

                  <div
                    className={cn(
                      "timeline-node relative flex items-center justify-center rounded-full border-2 transition-all duration-500",
                      isFinale ? "h-14 w-14" : "h-12 w-12",
                      isCompleted
                        ? "border-gold bg-surface-deep text-gold shadow-[0_0_20px_rgba(255,204,106,0.3)]"
                        : isApplicationsOpen
                          ? "border-green-400 bg-surface-deep text-green-400 shadow-[0_0_20px_rgba(74,222,128,0.2)]"
                          : isFinale
                            ? "border-gold/50 bg-surface-deep text-gold/70"
                            : "border-purple/30 bg-surface-deep text-purple/40"
                    )}
                  >
                    {isCompleted ? (
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : isFinale ? (
                      <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
                        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                      </svg>
                    ) : (
                      <CityIcon city={chapter.city} className="h-5 w-5" />
                    )}
                  </div>
                </div>

                {/* Content card */}
                <Link
                  href={isApplicationsOpen ? `/apply/${chapter.slug}` : `/matches/${chapter.slug}`}
                  className={cn(
                    "group block min-w-0 flex-1",
                    "md:w-[calc(50%-40px)] md:flex-none",
                    i % 2 === 0 ? "md:mr-auto md:pr-12" : "md:ml-auto md:pl-12"
                  )}
                >
                  <div className={cn(
                    "relative overflow-hidden rounded-2xl border transition-all duration-500",
                    isCompleted
                      ? "border-gold/20 hover:border-gold/40 hover:shadow-[0_0_40px_rgba(255,204,106,0.08)]"
                      : isApplicationsOpen
                        ? "border-green-400/20 hover:border-green-400/40 hover:shadow-[0_0_40px_rgba(74,222,128,0.08)]"
                        : isFinale
                          ? "border-gold/10 hover:border-gold/30"
                          : "border-white/[0.06] hover:border-white/10",
                    "bg-surface-card/60 hover:bg-surface-card"
                  )}>
                    {/* Corner accents */}
                    <div className="absolute top-0 left-0 h-10 w-px bg-gradient-to-b from-purple/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                    <div className="absolute top-0 left-0 h-px w-10 bg-gradient-to-r from-purple/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                    <div className="absolute bottom-0 right-0 h-10 w-px bg-gradient-to-t from-purple/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                    <div className="absolute bottom-0 right-0 h-px w-10 bg-gradient-to-l from-purple/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                    {/* Hero image */}
                    {heroImage && (
                      <div className="relative h-40 overflow-hidden">
                        <Image
                          src={heroImage}
                          alt={chapter.name}
                          fill
                          className="object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-surface-card to-transparent" />
                      </div>
                    )}

                    <div className="p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                            {isFinale ? "Grand Finale" : `Match ${chapter.matchNumber}`}
                          </p>
                          <h3 className={cn(
                            "mt-1.5 font-hero-display text-2xl font-black transition-colors duration-300",
                            isCompleted ? "text-gold"
                              : isApplicationsOpen ? "text-green-400 group-hover:text-green-300"
                              : isFinale ? "text-gold/80 group-hover:text-gold"
                              : "text-text-primary group-hover:text-gold"
                          )}>
                            {chapter.city}
                          </h3>
                          <p className="mt-1 text-sm text-text-secondary">
                            {chapter.country} &middot; {formatDateRange(chapter.date, chapter.dateEnd)}
                          </p>
                        </div>
                        {isApplicationsOpen ? (
                          <span className="shrink-0 rounded-full border border-green-400/25 bg-green-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-green-400">
                            Apply Now
                          </span>
                        ) : isFinale && !isCompleted ? (
                          <span className="shrink-0 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gold">
                            Finale
                          </span>
                        ) : (
                          <Badge variant={statusBadgeVariant[chapter.status] || "upcoming"}>
                            {statusLabel[chapter.status] || (chapter.status === "completed" ? "Completed" : "Upcoming")}
                          </Badge>
                        )}
                      </div>

                      {chapter.description && (
                        <p className="mt-3 text-sm leading-relaxed text-text-muted line-clamp-2">
                          {chapter.description}
                        </p>
                      )}

                      {/* Partner logos */}
                      {chapterPartners.length > 0 && (
                        <div className="mt-4 flex items-center gap-4 border-t border-white/[0.04] pt-4">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Partners</span>
                          <div className="flex flex-wrap items-center gap-3">
                            {chapterPartners.map((partner) => (
                              <Image
                                key={partner.id}
                                src={partner.logoUrl}
                                alt={partner.name}
                                width={80}
                                height={20}
                                className="h-5 w-auto object-contain opacity-50"
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </div>
            </div>
            </TimelineScrollHighlight>
          );
        })}
      </div>
    </Section>
  );
}
