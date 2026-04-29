import { Badge } from "@/components/ui/badge";
import { formatDateFull } from "@/lib/utils";
import { DeadlineCountdown } from "@/components/submission/deadline-countdown";
import type { Chapter } from "@/lib/types";

interface ChapterHackingProps {
  chapter: Chapter;
}

export function ChapterHacking({ chapter }: ChapterHackingProps) {
  return (
    <div className="relative">
      <div className="glow-blob glow-blob-purple absolute -right-60 -top-40 h-[500px] w-[500px] opacity-15" />
      <div className="glow-blob glow-blob-gold absolute -left-40 top-1/3 h-[400px] w-[400px] opacity-10" />

      <div className="relative text-center">
        <Badge variant="announced">Hacking in Progress</Badge>
        <h1 className="mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
          {chapter.name}
        </h1>
        <p className="mt-3 text-text-secondary">
          {chapter.city}, {chapter.country} &middot; {formatDateFull(chapter.date, chapter.dateEnd)}
        </p>
        {chapter.description && (
          <p className="mx-auto mt-4 max-w-2xl font-hero-body leading-relaxed text-text-secondary">
            {chapter.description}
          </p>
        )}

        {/* Live status */}
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-purple/20 bg-surface-card/40 p-8">
          <div className="flex items-center justify-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-purple/20" />
              <div className="relative h-3 w-3 rounded-full bg-purple" />
            </div>
            <p className="text-lg font-bold text-purple-light">Teams are building</p>
          </div>
        </div>

        {/* Submission deadline countdown */}
        {chapter.submissionDeadline && (
          <div className="mx-auto max-w-md">
            <DeadlineCountdown
              deadline={chapter.submissionDeadline}
              activeMessage=""
            />
          </div>
        )}
      </div>
    </div>
  );
}
