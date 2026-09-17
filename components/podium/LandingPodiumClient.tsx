"use client";

import { useRef } from "react";
import { useInView } from "framer-motion";
import type { LeaderboardEntry } from "@/lib/types";
import { RANK_COLORS } from "@/lib/design-tokens";
import { GlassPillar } from "./GlassPillar";
import { buildPodium } from "@/lib/podium";

interface LandingPodiumClientProps {
  entries: LeaderboardEntry[];
}

const RANK_HEIGHTS_CLASSIC: Record<number, string> = {
  1: "h-44 sm:h-56",
  2: "h-32 sm:h-40",
  3: "h-24 sm:h-32",
};

export function LandingPodiumClient({ entries }: LandingPodiumClientProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });

  // Every team on rank 1, 2 or 3 gets a pillar: a tie widens that place.
  // Same grouping as components/leaderboard/podium.tsx.
  const { slots, hiddenCount, tiedForFirst } = buildPodium(entries);
  if (slots.length < 3 && hiddenCount === 0) return null;

  return (
    <div ref={ref} className={`relative mx-auto ${slots.length > 3 ? "max-w-5xl" : "max-w-2xl"}`}>
      {tiedForFirst >= 2 && (
        <div className="mb-10 flex flex-col items-center gap-3">
          <svg
            className="h-10 w-10 text-ci-jasmine drop-shadow-[0_0_20px_rgba(255,206,119,0.5)] sm:h-12 sm:w-12"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0116.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.02 1.272 6.023 6.023 0 01-2.02-1.272"
            />
          </svg>
          <div className="flex items-center gap-3">
            <div className="h-px w-10 bg-gradient-to-r from-transparent to-ci-jasmine/40" />
            <span className="font-hero-heading text-xs font-black uppercase tracking-[0.3em] text-ci-jasmine">
              {tiedForFirst} Teams Tied for 1st
            </span>
            <div className="h-px w-10 bg-gradient-to-l from-transparent to-ci-jasmine/40" />
          </div>
        </div>
      )}

      {/* Stage spotlight effect */}
      <div className="stage-spotlight-wide pointer-events-none absolute inset-x-0 -top-20 h-80" />
      <div className="relative flex items-end justify-center gap-1.5 sm:gap-5">
        {slots.map(({ entry, rank }, i) => (
          <div key={entry.team.id} className="min-w-0 flex-1 sm:max-w-[200px]">
            <GlassPillar
              rank={rank}
              teamName={entry.team.name}
              points={entry.totalPoints}
              color={RANK_COLORS[rank] ?? RANK_COLORS[3]}
              height={RANK_HEIGHTS_CLASSIC[rank] ?? "h-24 sm:h-32"}
              delay={(rank - 1) * 0.12 + i * 0.04}
              isInView={isInView}
            />
          </div>
        ))}
      </div>
      <div className="mx-auto mt-0 h-[2px] max-w-lg bg-gradient-to-r from-transparent via-ci-jasmine/20 to-transparent" />

      {hiddenCount > 0 && (
        <p className="mt-4 text-center text-xs text-text-muted">
          +{hiddenCount} more tied, see the full leaderboard
        </p>
      )}
    </div>
  );
}
