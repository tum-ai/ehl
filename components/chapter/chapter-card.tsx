import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import type { Chapter } from "@/lib/types";

interface ChapterCardProps {
  chapter: Chapter;
}

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

export function ChapterCard({ chapter }: ChapterCardProps) {
  return (
    <Link href={`/matches/${chapter.slug}`}>
      <div
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/60 p-6 transition-all duration-300 hover:border-white/10 hover:bg-surface-card",
          chapter.isFinale && "border-ci-jasmine/20 hover:border-ci-jasmine/30"
        )}
      >
        {/* Hover glow */}
        <div className={cn(
          "absolute -right-8 -top-8 h-24 w-24 rounded-full blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100",
          chapter.isFinale ? "bg-ci-jasmine/10" : "bg-ci-lavender/10"
        )} />

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
              {chapter.isFinale ? "Grand Finale" : `Match ${chapter.matchNumber}`}
            </p>
            <h3 className="mt-2 font-hero-display text-2xl font-black text-text-primary group-hover:text-ci-jasmine transition-colors duration-200">
              {chapter.city}
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              {chapter.country}
            </p>
          </div>
          <Badge variant={statusBadgeVariant[chapter.status] || "upcoming"}>
            {statusLabel[chapter.status] || (chapter.status === "completed" ? "Completed" : chapter.status === "announced" ? "Upcoming" : chapter.status)}
          </Badge>
        </div>

        <div className="relative mt-5 flex items-center justify-between text-sm text-text-muted">
          <span>{formatDate(chapter.date)}</span>
          {chapter.isFinale && (
            <span className="text-xs font-bold uppercase tracking-wider text-ci-jasmine/50">Top 15</span>
          )}
        </div>
      </div>
    </Link>
  );
}
