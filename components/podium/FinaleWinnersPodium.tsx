"use client";

import { useRef } from "react";
import { useInView } from "framer-motion";
import { RANK_COLORS } from "@/lib/design-tokens";
import { finalePodiumSlots } from "@/lib/finale";
import { GlassPillar } from "./GlassPillar";

const RANK_HEIGHTS: Record<number, string> = {
  1: "h-44 sm:h-56",
  2: "h-32 sm:h-40",
  3: "h-24 sm:h-32",
};

// The Grand Finale winners (lib/finale.ts) on the glass-pillar podium. No points:
// the finale was decided on stage, so the season points stay in the table.
export function FinaleWinnersPodium({ spotlight = false }: { spotlight?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const slots = finalePodiumSlots();

  return (
    <div ref={ref} className="relative mx-auto max-w-2xl">
      {spotlight && (
        <div className="stage-spotlight-wide pointer-events-none absolute inset-x-0 -top-20 h-80" />
      )}
      <div className="relative flex items-end justify-center gap-1.5 sm:gap-5">
        {slots.map(({ teamName, place }) => (
          <div key={teamName} className="min-w-0 flex-1 sm:max-w-[200px]">
            <GlassPillar
              rank={place}
              teamName={teamName}
              color={RANK_COLORS[place]}
              height={RANK_HEIGHTS[place]}
              // 1st rises first, then 2nd, then 3rd
              delay={(place - 1) * 0.12}
              isInView={isInView}
            />
          </div>
        ))}
      </div>
      <div className="mx-auto mt-0 h-[2px] max-w-lg bg-gradient-to-r from-transparent via-ci-jasmine/20 to-transparent" />
    </div>
  );
}
