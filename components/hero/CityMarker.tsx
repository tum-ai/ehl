"use client";

import { motion } from "framer-motion";
import { EASING } from "@/lib/design-tokens";

interface CityMarkerProps {
  cx: number;
  cy: number;
  name: string;
  color: string;
  isOrigin: boolean;
  isVisible: boolean;
  isComplete: boolean;
  pulsePeriod: number;
  showLabel?: boolean;
}

export function CityMarker({
  cx,
  cy,
  name,
  color,
  isOrigin,
  isVisible,
  isComplete,
  pulsePeriod,
  showLabel = true,
}: CityMarkerProps) {
  const coreRadius = isOrigin ? 4 : 3;
  const glowRadius = isOrigin ? 15 : 11;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0 }}
      animate={
        isVisible
          ? { opacity: 1, scale: 1 }
          : { opacity: 0, scale: 0 }
      }
      transition={{
        duration: 0.5,
        ease: EASING.pop,
      }}
      style={{ transformOrigin: `${cx}px ${cy}px` }}
    >
      {/* Atmospheric glow halo */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={glowRadius}
        fill={color}
        opacity={0.15}
        animate={
          isComplete
            ? {
                opacity: [0.1, 0.2, 0.1],
                r: [glowRadius, glowRadius * 1.3, glowRadius],
              }
            : {}
        }
        transition={
          isComplete
            ? {
                duration: pulsePeriod,
                repeat: Infinity,
                ease: "easeInOut",
              }
            : {}
        }
      />

      {/* Soft glow ring */}
      <circle
        cx={cx}
        cy={cy}
        r={glowRadius * 0.65}
        fill="none"
        stroke={color}
        strokeWidth={0.5}
        opacity={0.2}
      />

      {/* Core solid dot */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={coreRadius}
        fill={color}
        animate={
          isComplete
            ? {
                r: [coreRadius, coreRadius * 1.08, coreRadius],
              }
            : {}
        }
        transition={
          isComplete
            ? {
                duration: pulsePeriod,
                repeat: Infinity,
                ease: "easeInOut",
              }
            : {}
        }
      />

      {/* City label */}
      {showLabel && (
        <text
          x={cx}
          y={cy - (isOrigin ? 22 : 18)}
          textAnchor="middle"
          fill={color}
          fontSize={isOrigin ? 11 : 9}
          fontFamily="var(--font-hero-body)"
          fontWeight={isOrigin ? 700 : 500}
          letterSpacing="0.05em"
          opacity={0.9}
        >
          {name}
        </text>
      )}
    </motion.g>
  );
}
