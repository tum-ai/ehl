"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASING } from "@/lib/design-tokens";

interface GlassPillarProps {
  rank: number;
  teamName: string;
  points: number;
  color: string;
  height: string;
  delay: number;
  isInView: boolean;
}

export function GlassPillar({
  rank,
  teamName,
  points,
  color,
  height,
  delay,
  isInView,
}: GlassPillarProps) {
  // CSS custom property drives all glass-pillar-* utilities
  const pillarVars = { "--pillar-color": color } as React.CSSProperties;

  return (
    <motion.div
      className="flex flex-col items-center"
      initial={{ opacity: 0, y: 60 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 60 }}
      transition={{
        duration: 0.7,
        delay,
        ease: EASING.enter,
      }}
    >
      {/* Team info above pillar */}
      <div className="mb-3 flex flex-col items-center text-center">
        <p className="max-w-full truncate font-hero-display text-[11px] font-bold text-text-primary sm:text-sm">
          {teamName}
        </p>

        <p
          className="mt-1 font-mono text-2xl font-black sm:text-3xl"
          style={{
            color,
            filter: `drop-shadow(0 0 12px ${color}60)`,
          }}
        >
          {points}
        </p>
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
          points
        </p>
      </div>

      {/* Glass pillar — driven by --pillar-color CSS variable */}
      <div
        className={cn(
          "glass-pillar relative w-full overflow-hidden rounded-t-[20px]",
          height
        )}
        style={pillarVars}
      >
        {/* Spotlight cone from top */}
        <div className="glass-pillar-spotlight absolute inset-0" />

        {/* Vertical light beam */}
        <div className="glass-pillar-beam absolute inset-0" />

        {/* Top edge highlight */}
        <div className="glass-pillar-edge absolute inset-x-0 top-0 h-[1px]" />

        {/* Corner light catches */}
        <div className="glass-pillar-corner absolute left-0 top-0 h-16 w-[1px]" />
        <div className="glass-pillar-corner absolute right-0 top-0 h-16 w-[1px]" />

        {/* Rank number */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <span
            className="font-hero-display text-[80px] font-black leading-none sm:text-[120px]"
            style={{
              color: `${color}70`,
              filter: `drop-shadow(0 0 40px ${color}25)`,
            }}
          >
            {rank}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
