import { Badge } from "@/components/ui/badge";
import { formatDateRange } from "@/lib/utils";
import type { Chapter } from "@/lib/types";

interface ChapterAnnouncedProps {
  chapter: Chapter;
  screeningMessage?: string;
}

export function ChapterAnnounced({ chapter, screeningMessage }: ChapterAnnouncedProps) {
  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-surface-card to-surface-deep p-8 sm:p-12">
        <div className="glow-blob glow-blob-purple absolute -right-20 -top-20 h-48 w-48 opacity-25" />

        <div className="relative z-10">
          <Badge variant="announced">
            {screeningMessage ? "Preparation" : chapter.isFinale ? "Grand Finale" : "Upcoming"}
          </Badge>
          <h1 className="mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
            {chapter.name}
          </h1>
          <p className="mt-3 text-text-secondary">
            {chapter.city}, {chapter.country} &middot; {formatDateRange(chapter.date, chapter.dateEnd)}
          </p>
          {screeningMessage && (
            <p className="mt-4 rounded-lg border border-gold/20 bg-gold/5 px-4 py-3 text-sm font-medium text-gold">
              {screeningMessage}
            </p>
          )}
          <p className="mt-4 max-w-2xl font-hero-body leading-relaxed text-text-secondary">
            {chapter.description}
          </p>
        </div>
      </div>

      {/* What to expect */}
      <div className="mt-12">
        <h2 className="mb-6 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
          What to expect
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { title: "Compete", desc: "Multiple challenges from industry sponsors. Pick one and build your solution in 24h." },
            { title: "Pitch", desc: "Present to a jury of experts. Every pitch is a chance to prove your team." },
            { title: "Score", desc: "Top 5 placements earn league points. Every submission earns at least +2." },
          ].map((item) => (
            <div key={item.title} className="group rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 transition-all duration-300 hover:border-purple/20 hover:bg-surface-card/60">
              <h3 className="font-hero-heading text-lg font-bold text-purple-light">{item.title}</h3>
              <p className="mt-2 font-hero-body text-sm leading-relaxed text-text-secondary">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {chapter.isFinale && (
        <div className="mt-12 rounded-2xl border border-gold/15 bg-gold/5 p-8 text-center">
          <p className="text-xl font-black gradient-text">
            Top 15 teams qualify
          </p>
          <p className="mt-3 text-sm text-text-secondary">
            The Grand Finale brings the best teams together for one final competition in Munich.
          </p>
        </div>
      )}
    </div>
  );
}
