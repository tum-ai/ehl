import Link from "next/link";
import Image from "next/image";
import { Section, SectionTitle } from "@/components/ui/section";
import { CityIcon } from "@/components/ui/city-icon";
import { getChapters, getAllPartners } from "@/lib/queries";
import { formatDateRange, cn } from "@/lib/utils";

export async function TourTimeline() {
  const [chapters, allPartners] = await Promise.all([
    getChapters(),
    getAllPartners(),
  ]);

  return (
    <Section className="relative overflow-hidden">
      <div className="glow-blob glow-blob-gold absolute -left-40 top-1/2 h-[400px] w-[400px] opacity-20" />
      <div className="glow-blob glow-blob-purple absolute -right-40 top-0 h-[300px] w-[300px] opacity-10" />

      <SectionTitle>The Tour</SectionTitle>

      {/* Desktop: horizontal timeline */}
      <div className="hidden md:block">
        <div className="relative px-[6%]">
          <div
            className="relative grid"
            style={{ gridTemplateColumns: `repeat(${chapters.length}, 1fr)` }}
          >
            {chapters.map((chapter, i) => {
              const isCompleted = chapter.status === "completed";
              const isApplicationsOpen = chapter.status === "applications_open";
              const isFinale = chapter.isFinale;
              const isLast = i === chapters.length - 1;
              const nextIsFinale = !isLast && chapters[i + 1].isFinale;
              const chapterPartners = allPartners.filter((p) => p.chapterId === chapter.id);

              return (
                <Link
                  key={chapter.id}
                  href={isApplicationsOpen ? `/apply/${chapter.slug}` : `/matches/${chapter.slug}`}
                  className="group relative flex flex-col items-center"
                >
                  {/* Line segment from this node center to next node center */}
                  {!isLast && (() => {
                    const totalSegs = chapters.length - 1;
                    // Progress through the overall gradient (0 = start, 1 = end)
                    const tStart = i / totalSegs;
                    const tEnd = (i + 1) / totalSegs;
                    // Interpolate gold(60%) → purple(20%) opacity
                    const startOpacity = Math.round((0.6 - tStart * 0.4) * 100);
                    const endOpacity = Math.round((0.6 - tEnd * 0.4) * 100);
                    // Blend from gold-dominant to purple-dominant
                    const startColor = tStart < 0.5
                      ? `rgba(255,206,119,${startOpacity / 100})`
                      : `rgba(154,100,217,${startOpacity / 100})`;
                    const endColor = tEnd < 0.5
                      ? `rgba(255,206,119,${endOpacity / 100})`
                      : `rgba(154,100,217,${endOpacity / 100})`;
                    return (
                      // All nodes sit in a 68px-tall container; line at 34px (vertical center)
                      <div className="pointer-events-none absolute top-[34px] left-1/2 h-[2px]" style={{ width: "100%" }}>
                        {nextIsFinale ? (
                          <div className="h-full w-full border-t-2 border-dashed border-ci-jasmine/25" />
                        ) : (
                          <div
                            className="h-full w-full"
                            style={{ background: `linear-gradient(to right, ${startColor}, ${endColor})` }}
                          />
                        )}
                      </div>
                    );
                  })()}

                  {/* Node circle with glow ring — wrapped in fixed-height container so all nodes share the same vertical center */}
                  <div className="relative flex h-[68px] items-center justify-center">
                    {/* Glow ring behind node */}
                    {(isCompleted || isFinale) && (
                      <div className={cn(
                        "absolute animate-glow-pulse rounded-full blur-md",
                        isFinale ? "inset-0 bg-ci-jasmine/25" : "inset-[6px] bg-ci-jasmine/20"
                      )} />
                    )}
                    {isApplicationsOpen && (
                      <div className="absolute inset-[6px] animate-glow-pulse rounded-full bg-green-400/20 blur-md" />
                    )}

                    <div
                      className={cn(
                        "relative z-10 flex items-center justify-center rounded-full border-2 transition-all duration-500",
                        isFinale ? "h-[68px] w-[68px]" : "h-14 w-14",
                        isCompleted
                          ? "border-ci-jasmine bg-surface-deep text-ci-jasmine shadow-[0_0_30px_rgba(255,206,119,0.25)]"
                          : isApplicationsOpen
                            ? "border-green-400 bg-surface-deep text-green-400 shadow-[0_0_25px_rgba(74,222,128,0.2)]"
                            : isFinale
                              ? "border-ci-jasmine/50 bg-surface-deep text-ci-jasmine/70 group-hover:border-ci-jasmine group-hover:text-ci-jasmine group-hover:shadow-[0_0_35px_rgba(255,206,119,0.2)]"
                              : "border-ci-lavender/30 bg-surface-deep text-ci-lavender/40 group-hover:border-ci-lavender/60 group-hover:text-ci-lavender/80 group-hover:shadow-[0_0_25px_rgba(154,100,217,0.2)]"
                      )}
                    >
                      {isCompleted ? (
                        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : isFinale ? (
                        <svg className={cn("fill-current", isFinale ? "h-7 w-7" : "h-6 w-6")} viewBox="0 0 24 24">
                          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                        </svg>
                      ) : (
                        <CityIcon city={chapter.city} />
                      )}
                    </div>
                  </div>

                  {/* City name or Makeathon logo */}
                  {chapter.slug === "munich-1" ? (
                    <Image
                      src="/makeathon/makeathon-logo.svg"
                      alt="Makeathon 2026"
                      width={100}
                      height={30}
                      className="mt-3 h-6 w-auto object-contain drop-shadow-[0_0_8px_rgba(255,206,119,0.2)]"
                    />
                  ) : (
                    <p className={cn(
                      "mt-2 font-hero-display text-sm font-bold transition-colors duration-300",
                      isCompleted ? "text-ci-jasmine"
                        : isApplicationsOpen ? "text-green-400"
                        : isFinale ? "text-ci-jasmine/80 group-hover:text-ci-jasmine"
                        : "text-text-secondary group-hover:text-text-primary"
                    )}>
                      {isFinale ? "Grand Finale" : chapter.city}
                    </p>
                  )}

                  {/* Date */}
                  <p className="mt-0.5 font-hero-body text-xs text-text-muted">
                    {formatDateRange(chapter.date, chapter.dateEnd)}
                  </p>

                  {/* Status badges */}
                  {isApplicationsOpen && (
                    <span className="mt-1.5 rounded-full border border-green-400/25 bg-green-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-400">
                      Apply Now
                    </span>
                  )}

                  {isFinale && !isApplicationsOpen && (
                    <span className="mt-1.5 rounded-full border border-ci-jasmine/30 bg-ci-jasmine/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ci-jasmine">
                      Finale
                    </span>
                  )}

                  {/* Partner logos */}
                  {chapterPartners.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                      {chapterPartners.slice(0, 4).map((partner) => (
                        <Image
                          key={partner.id}
                          src={partner.logoUrl}
                          alt={partner.name}
                          width={40}
                          height={16}
                          className="h-3.5 w-auto object-contain opacity-30 transition-opacity duration-300 group-hover:opacity-60"
                        />
                      ))}
                      {chapterPartners.length > 4 && (
                        <span className="text-[9px] text-text-muted">+{chapterPartners.length - 4}</span>
                      )}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mobile: centered vertical timeline with alternating sides */}
      <div className="md:hidden">
        <div className="relative mx-auto max-w-xs">
          {chapters.map((chapter, i) => {
            const isCompleted = chapter.status === "completed";
            const isApplicationsOpen = chapter.status === "applications_open";
            const isFinale = chapter.isFinale;
            const isLast = i === chapters.length - 1;
            const nextIsFinale = !isLast && chapters[i + 1].isFinale;
            const isLeft = i % 2 === 0;

            return (
              <Link
                key={chapter.id}
                href={isApplicationsOpen ? `/apply/${chapter.slug}` : `/matches/${chapter.slug}`}
                className="group relative mb-8 flex items-start last:mb-0"
              >
                {/* Vertical line from this node to next */}
                {!isLast && (
                  <div
                    className="absolute left-1/2 w-[2px] -translate-x-px"
                    style={{
                      top: isFinale ? "44px" : "36px",
                      height: "calc(100% - 4px)",
                    }}
                  >
                    {nextIsFinale ? (
                      <div className="h-full border-l-2 border-dashed border-ci-jasmine/25" />
                    ) : (
                      <div className="h-full bg-ci-lavender/20" />
                    )}
                  </div>
                )}

                {/* Left-side content (even items) */}
                {isLeft ? (
                  <div className="flex w-[calc(50%-24px)] justify-end pr-4 text-right">
                    <div>
                      <p className={cn(
                        "font-hero-display font-bold transition-colors",
                        isCompleted ? "text-ci-jasmine"
                          : isApplicationsOpen ? "text-green-400"
                          : isFinale ? "text-ci-jasmine/80"
                          : "text-text-secondary group-hover:text-ci-jasmine"
                      )}>
                        {isFinale ? "Grand Finale" : chapter.city}
                      </p>
                      <p className="font-hero-body text-sm text-text-muted">{formatDateRange(chapter.date, chapter.dateEnd)}</p>
                      {isApplicationsOpen && (
                        <span className="mt-1 inline-block rounded-full border border-green-400/25 bg-green-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-400">
                          Apply Now
                        </span>
                      )}
                      {isFinale && !isApplicationsOpen && (
                        <span className="mt-1 inline-block rounded-full border border-ci-jasmine/30 bg-ci-jasmine/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ci-jasmine">
                          Finale
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-[calc(50%-24px)]" />
                )}

                {/* Center node */}
                <div className="relative z-10 flex w-12 shrink-0 items-center justify-center">
                  {(isCompleted || isFinale) && (
                    <div className={cn(
                      "absolute inset-0 animate-glow-pulse rounded-full blur-md",
                      isFinale ? "bg-ci-jasmine/25" : "bg-ci-jasmine/20"
                    )} />
                  )}
                  {isApplicationsOpen && (
                    <div className="absolute inset-0 animate-glow-pulse rounded-full bg-green-400/20 blur-md" />
                  )}
                  <div
                    className={cn(
                      "relative flex items-center justify-center rounded-full border-2",
                      isFinale ? "h-12 w-12" : "h-10 w-10",
                      isCompleted
                        ? "border-ci-jasmine bg-surface-deep text-ci-jasmine shadow-[0_0_20px_rgba(255,206,119,0.2)]"
                        : isApplicationsOpen
                          ? "border-green-400 bg-surface-deep text-green-400 shadow-[0_0_20px_rgba(74,222,128,0.15)]"
                          : isFinale
                            ? "border-ci-jasmine/50 bg-surface-deep text-ci-jasmine/70"
                            : "border-ci-lavender/30 bg-surface-deep text-ci-lavender/40"
                    )}
                  >
                    {isCompleted ? (
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : isFinale ? (
                      <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
                      </svg>
                    ) : (
                      <CityIcon city={chapter.city} />
                    )}
                  </div>
                </div>

                {/* Right-side content (odd items) */}
                {!isLeft ? (
                  <div className="w-[calc(50%-24px)] pl-4">
                    <div>
                      <p className={cn(
                        "font-hero-display font-bold transition-colors",
                        isCompleted ? "text-ci-jasmine"
                          : isApplicationsOpen ? "text-green-400"
                          : isFinale ? "text-ci-jasmine/80"
                          : "text-text-secondary group-hover:text-ci-jasmine"
                      )}>
                        {isFinale ? "Grand Finale" : chapter.city}
                      </p>
                      <p className="font-hero-body text-sm text-text-muted">{formatDateRange(chapter.date, chapter.dateEnd)}</p>
                      {isApplicationsOpen && (
                        <span className="mt-1 inline-block rounded-full border border-green-400/25 bg-green-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-400">
                          Apply Now
                        </span>
                      )}
                      {isFinale && !isApplicationsOpen && (
                        <span className="mt-1 inline-block rounded-full border border-ci-jasmine/30 bg-ci-jasmine/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ci-jasmine">
                          Finale
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-[calc(50%-24px)]" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
