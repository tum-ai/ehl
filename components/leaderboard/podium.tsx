"use client";

import { useRef } from "react";
import { useInView } from "framer-motion";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/types";
import { RANK_COLORS } from "@/lib/design-tokens";
import { GlassPillar } from "@/components/podium/GlassPillar";

interface PodiumProps {
  entries: LeaderboardEntry[];
  compact?: boolean;
}

const RANK_HEIGHTS: Record<number, string> = {
  1: "h-44 sm:h-56",
  2: "h-32 sm:h-40",
  3: "h-24 sm:h-32",
};

const RANK_HEIGHTS_COMPACT: Record<number, string> = {
  1: "h-36 sm:h-44",
  2: "h-24 sm:h-32",
  3: "h-16 sm:h-24",
};

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

export function Podium({ entries, compact = false }: PodiumProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const rank1 = entries.filter((e) => e.rank === 1);

  const heights = compact ? RANK_HEIGHTS_COMPACT : RANK_HEIGHTS;

  // All tied for 1st
  if (rank1.length > 2) {
    return (
      <div ref={ref}>
        {/* Trophy + tied banner */}
        <div className="mb-10 flex flex-col items-center gap-3">
          <TrophyIcon
            className="h-10 w-10 text-ci-jasmine drop-shadow-[0_0_20px_rgba(255,206,119,0.5)] sm:h-12 sm:w-12"
          />
          <div className="flex items-center gap-3">
            <div className="h-px w-10 bg-gradient-to-r from-transparent to-ci-jasmine/40" />
            <span className="font-hero-heading text-xs font-black uppercase tracking-[0.3em] text-ci-jasmine">
              {rank1.length} Teams Tied for 1st
            </span>
            <div className="h-px w-10 bg-gradient-to-l from-transparent to-ci-jasmine/40" />
          </div>
        </div>

        {/* Equal-height pillars */}
        <div className="flex items-end justify-center gap-1.5 sm:gap-5">
          {rank1.map((entry, i) => (
            <div
              key={entry.team.id}
              className="min-w-0 flex-1 sm:max-w-[180px]"
            >
              <GlassPillar
                rank={1}
                teamName={entry.team.name}
                points={entry.totalPoints}
                color={RANK_COLORS[1]}
                height={heights[1] ?? "h-40 sm:h-48"}
                delay={i * 0.12}
                isInView={isInView}
              />
            </div>
          ))}
        </div>

        {/* Base line */}
        <div className="mx-auto mt-0 h-[2px] max-w-xl bg-gradient-to-r from-transparent via-ci-jasmine/30 to-transparent" />
      </div>
    );
  }

  // Classic top 3 (2nd / 1st / 3rd order)
  const top3 = entries.filter((e) => e.rank <= 3).slice(0, 3);

  // The classic 2nd/1st/3rd podium only works when distinct ranks 1, 2 and 3
  // all exist. With ties (e.g. ranks [1,1,3] — two share 1st, so there is no
  // rank 2) those slots are missing; render the tied-for-1st layout instead of
  // crashing on a missing entry.
  const hasDistinctTop3 =
    top3.length === 3 &&
    top3.some((e) => e.rank === 1) &&
    top3.some((e) => e.rank === 2) &&
    top3.some((e) => e.rank === 3);

  if (!hasDistinctTop3) {
    // 2+ tied for 1st (with or without additional ranked teams below)
    if (rank1.length >= 2) {
      const tied = rank1.slice(0, 3);
      return (
        <div ref={ref}>
          <div className="mb-10 flex flex-col items-center gap-3">
            <TrophyIcon className="h-10 w-10 text-ci-jasmine drop-shadow-[0_0_20px_rgba(255,206,119,0.5)] sm:h-12 sm:w-12" />
            <div className="flex items-center gap-3">
              <div className="h-px w-10 bg-gradient-to-r from-transparent to-ci-jasmine/40" />
              <span className="font-hero-heading text-xs font-black uppercase tracking-[0.3em] text-ci-jasmine">
                {rank1.length} Teams Tied for 1st
              </span>
              <div className="h-px w-10 bg-gradient-to-l from-transparent to-ci-jasmine/40" />
            </div>
          </div>
          <div className="flex items-end justify-center gap-3 sm:gap-5">
            {tied.map((entry, i) => (
              <div key={entry.team.id} className="w-full max-w-[30%] sm:max-w-[200px]">
                <GlassPillar
                  rank={1}
                  teamName={entry.team.name}
                  points={entry.totalPoints}
                  color={RANK_COLORS[1]}
                  height={heights[1] ?? "h-44 sm:h-56"}
                  delay={i * 0.12}
                  isInView={isInView}
                />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-0 h-[2px] max-w-lg bg-gradient-to-r from-transparent via-ci-jasmine/20 to-transparent" />
        </div>
      );
    }
    // A single leader but no clean 2nd/3rd (e.g. ranks [1,3,3]): show whatever
    // top entries exist as equal pillars rather than forcing the 3-slot layout.
    if (top3.length > 0) {
      return (
        <div ref={ref} className="mx-auto max-w-2xl">
          <div className="flex items-end justify-center gap-1.5 sm:gap-5">
            {top3.map((entry, i) => (
              <div key={entry.team.id} className="w-full min-w-0 max-w-[33%] sm:max-w-[200px]">
                <GlassPillar
                  rank={entry.rank}
                  teamName={entry.team.name}
                  points={entry.totalPoints}
                  color={RANK_COLORS[entry.rank] ?? RANK_COLORS[3]}
                  height={heights[entry.rank] ?? "h-24 sm:h-32"}
                  delay={i * 0.12}
                  isInView={isInView}
                />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-0 h-[2px] max-w-lg bg-gradient-to-r from-transparent via-ci-jasmine/20 to-transparent" />
        </div>
      );
    }
    return null;
  }

  if (top3.length < 3) {
    // 2 tied for 1st
    if (rank1.length === 2) {
      return (
        <div ref={ref}>
          <div className="mb-10 flex flex-col items-center gap-3">
            <TrophyIcon
              className="h-10 w-10 text-ci-jasmine drop-shadow-[0_0_20px_rgba(255,206,119,0.5)] sm:h-12 sm:w-12"
            />
            <div className="flex items-center gap-3">
              <div className="h-px w-10 bg-gradient-to-r from-transparent to-ci-jasmine/40" />
              <span className="font-hero-heading text-xs font-black uppercase tracking-[0.3em] text-ci-jasmine">
                2 Teams Tied for 1st
              </span>
              <div className="h-px w-10 bg-gradient-to-l from-transparent to-ci-jasmine/40" />
            </div>
          </div>
          <div className="flex items-end justify-center gap-3 sm:gap-5">
            {rank1.map((entry, i) => (
              <div key={entry.team.id} className="w-full max-w-[30%] sm:max-w-[200px]">
                <GlassPillar
                  rank={1}
                  teamName={entry.team.name}
                  points={entry.totalPoints}
                  color={RANK_COLORS[1]}
                  height={heights[1] ?? "h-44 sm:h-56"}
                  delay={i * 0.12}
                  isInView={isInView}
                />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-0 h-[2px] max-w-lg bg-gradient-to-r from-transparent via-ci-jasmine/20 to-transparent" />
        </div>
      );
    }
    return null;
  }

  const second = top3.find((e) => e.rank === 2)!;
  const first = top3.find((e) => e.rank === 1)!;
  const third = top3.find((e) => e.rank === 3)!;
  const podiumOrder = [
    { entry: second, rank: 2 },
    { entry: first, rank: 1 },
    { entry: third, rank: 3 },
  ];

  return (
    <div ref={ref} className="mx-auto max-w-2xl">
      <div className="flex items-end justify-center gap-1.5 sm:gap-5">
        {podiumOrder.map(({ entry, rank }, i) => (
          <div key={entry.team.id} className="w-full min-w-0 max-w-[33%] sm:max-w-[200px]">
            <GlassPillar
              rank={rank}
              teamName={entry.team.name}
              points={entry.totalPoints}
              color={RANK_COLORS[rank] ?? RANK_COLORS[3]}
              height={heights[rank] ?? "h-24 sm:h-32"}
              delay={i === 1 ? 0 : i === 0 ? 0.12 : 0.24}
              isInView={isInView}
            />
          </div>
        ))}
      </div>
      <div className="mx-auto mt-0 h-[2px] max-w-lg bg-gradient-to-r from-transparent via-ci-jasmine/20 to-transparent" />
    </div>
  );
}
