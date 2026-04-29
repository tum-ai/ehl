import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn, formatDateFull } from "@/lib/utils";
import type { Chapter, Challenge, PitchOrder, Team } from "@/lib/types";

interface ChapterPitchingProps {
  chapter: Chapter;
  challenges: Challenge[];
  pitchOrders: PitchOrder[];
  teams: Team[];
}

export function ChapterPitching({
  chapter,
  challenges,
  pitchOrders,
  teams,
}: ChapterPitchingProps) {
  return (
    <div className="relative">
      <div className="glow-blob glow-blob-purple absolute -right-60 -top-40 h-[500px] w-[500px] opacity-15" />
      <div className="glow-blob glow-blob-gold absolute -left-40 top-1/3 h-[400px] w-[400px] opacity-10" />

      <div className="relative text-center">
        <Badge variant="announced">Pitching</Badge>
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
      </div>

      {/* Pitch orders by challenge */}
      <div className="mt-12">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
            Pitch Order
          </h2>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-purple/30" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {challenges.map((challenge) => {
            const pitchOrder = pitchOrders.find((po) => po.challengeId === challenge.id);

            return (
              <Card key={challenge.id}>
                <div className="absolute top-0 left-0 h-8 w-px bg-gradient-to-b from-purple/30 to-transparent" />
                <div className="absolute top-0 left-0 h-px w-8 bg-gradient-to-r from-purple/30 to-transparent" />

                <h3 className="font-hero-heading text-lg font-bold text-purple-light">{challenge.title}</h3>
                {challenge.sponsorName && (
                  <p className="text-sm text-text-muted">by {challenge.sponsorName}</p>
                )}

                {pitchOrder ? (
                  <div className="mt-4 space-y-2">
                    {pitchOrder.orderList.map((teamId, index) => {
                      const team = teams.find((t) => t.id === teamId);
                      return (
                        <div
                          key={teamId}
                          className="flex items-center gap-3 rounded-xl border border-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.02]"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple/10 font-mono text-xs font-bold text-purple">
                            {index + 1}
                          </span>
                          <span className="font-medium">{team?.name || "Unknown Team"}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-text-muted">
                    Pitch order not yet published.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
