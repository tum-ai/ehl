"use client";

import { useRef, useMemo, useState, useEffect, type RefObject } from "react";
import { motion } from "framer-motion";
import { CI, type HeroPhase, phaseReached } from "@/lib/design-tokens";
import type { CityPosition } from "./MapLayer";

interface LogoEHLProps {
  phase: HeroPhase;
  cityPositions?: CityPosition[];
  logoContainerRef?: RefObject<HTMLDivElement | null>;
  isInView?: boolean;
}

// ─── SVG data ──────────────────────────────────────────────
const STAR_PATHS = [
  "M3146.15,687.893l53.322,164.106l172.552,0l-139.598,101.423l53.322,164.107l-139.598,-101.423l-139.597,101.423l53.322,-164.107l-139.598,-101.423l172.552,0l53.321,-164.106Z",
  "M3888.16,123.16l53.321,164.107l172.552,-0l-139.597,101.423l53.321,164.107l-139.597,-101.424l-139.598,101.424l53.322,-164.107l-139.598,-101.423l172.552,-0l53.322,-164.107Z",
  "M4803.39,0l53.321,164.107l172.552,-0l-139.597,101.423l53.321,164.106l-139.597,-101.423l-139.598,101.423l53.322,-164.106l-139.597,-101.423l172.551,-0l53.322,-164.107Z",
  "M5723.14,121.335l53.322,164.107l172.552,-0l-139.598,101.423l53.322,164.107l-139.598,-101.424l-139.597,101.424l53.322,-164.107l-139.598,-101.423l172.552,-0l53.321,-164.107Z",
  "M6460.14,687.893l53.321,164.106l172.552,0l-139.598,101.423l53.322,164.107l-139.597,-101.423l-139.598,101.423l53.322,-164.107l-139.598,-101.423l172.552,0l53.322,-164.106Z",
  "M6689.3,2461.81l53.322,164.106l172.551,0l-139.597,101.424l53.322,164.106l-139.598,-101.423l-139.597,101.423l53.321,-164.106l-139.597,-101.424l172.552,0l53.321,-164.106Z",
  "M6812.43,1538.74l53.322,164.106l172.552,0l-139.598,101.424l53.322,164.106l-139.598,-101.423l-139.597,101.423l53.321,-164.106l-139.597,-101.424l172.552,0l53.321,-164.106Z",
];

const STAR_CENTERS = [
  { x: 3146, y: 850 },
  { x: 3888, y: 290 },
  { x: 4803, y: 165 },
  { x: 5723, y: 290 },
  { x: 6460, y: 850 },
  { x: 6689, y: 2625 },
  { x: 6812, y: 1700 },
];

// Which city each star originates from
const STAR_CITY_MAP: string[] = [
  "Paris", "Munich", "Munich", "Munich", "Berlin", "Zurich", "Zurich",
];

const LETTER_PATHS = {
  E: "M300.339,3566.03c-168.671,-17.619 -300.339,-160.412 -300.339,-333.715c-0,-75.019 43.268,-200.228 43.268,-200.228l494.763,-1536l1711,-0l-177.879,552.228l-1024,0l4.62,-14.342c-3.703,4.887 -7.535,9.669 -11.494,14.342l6.874,0l-91.885,285.258l1024,-0l-142.539,442.514l-1024,-0l-82.46,256l1024,-0l-171.99,533.943l-1281.94,-0Z",
  H: "M2415.2,1695.49c52.255,-117.433 169.996,-199.396 306.73,-199.396l412.126,-0l-269.764,837.486l713.143,-0l269.764,-837.486l599.771,-0l-666.752,2069.94l-599.771,-0l254.449,-789.943l-713.142,-0l-254.45,789.943l-654.629,-0l602.525,-1870.55Z",
  L: "M4609.49,1695.48c52.256,-117.431 169.996,-199.393 306.729,-199.393l532.812,-0l-494.763,1536c0,-0 1053.19,0.041 1053.86,-0c69.686,-4.31 136.749,-36.777 196.183,-150.654l-220.516,684.597l-1976.83,-0l602.525,-1870.55Z",
};

// Large offsets so the star flight is unmissable.
// These are in SVG viewBox units (the logo SVG is 7039x3567).
// When city positions aren't available, stars fly in from far off-screen.
const STAR_FALLBACK_DIRECTIONS: { x: number; y: number }[] = [
  { x: -3000, y: -1500 },  // Paris star: from far upper-left
  { x: -1200, y: -2000 },  // Munich stars: from above
  { x: 0, y: -2200 },
  { x: 1200, y: -2000 },
  { x: 3000, y: -1500 },   // Berlin star: from far upper-right
  { x: 2500, y: 2000 },    // Zurich stars: from lower-right
  { x: 2800, y: 800 },
];

// ─── Flicker: capacitor charge/discharge pattern ───────────
// Real neon: gas tries to ionize, fails, tries again harder, eventually sustains
const FLICKER_OPACITY = [
  0, 0, 0.4, 0,       // first attempt: brief flash, fails
  0, 0, 0.7, 0.2, 0,  // second attempt: brighter, still fails
  0, 0.9, 0.5, 1.0,   // third attempt: almost catches
  0.85, 1, 0.93, 1,   // sustaining, slight instability
];
const FLICKER_TIMES = [
  0, 0.06, 0.09, 0.13,
  0.22, 0.32, 0.36, 0.40, 0.44,
  0.55, 0.60, 0.66, 0.72,
  0.80, 0.88, 0.94, 1,
];
const FLICKER_DURATION = 1.2;

// ─── Per-impact particle generation ────────────────────────
// Deterministic seeded random for consistent renders
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Particle {
  angle: number;
  dist: number;
  size: number;
  duration: number;
  delayOffset: number;
  bright: boolean;
}

function generateParticles(starIndex: number, count: number): Particle[] {
  const rng = seededRandom(starIndex * 1000 + 42);
  return Array.from({ length: count }, () => ({
    angle: rng() * Math.PI * 2,
    dist: 120 + rng() * 280,
    size: 2 + rng() * 8,
    duration: 0.4 + rng() * 0.6,
    delayOffset: rng() * 0.06,
    bright: rng() > 0.7,
  }));
}

// Pre-generate particles for all 7 stars (10 particles each)
const STAR_PARTICLES = STAR_PATHS.map((_, i) => generateParticles(i, 10));

// ─── Component ─────────────────────────────────────────────
export function LogoEHL({ phase, cityPositions, logoContainerRef, isInView = true }: LogoEHLProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const starsVisible = phaseReached(phase, "stars");
  const wordmarkVisible = phaseReached(phase, "wordmark");
  const isComplete = phase === "complete";

  // Track when the star animation has fully played (for collision timing)
  const [starsLanded, setStarsLanded] = useState(false);
  useEffect(() => {
    if (starsVisible && !starsLanded) {
      // Stars take: last star delay (6*0.2=1.2s) + flight (1.2s) + settle (0.3s) = ~2.7s
      const timer = setTimeout(() => setStarsLanded(true), 2700);
      return () => clearTimeout(timer);
    }
  }, [starsVisible, starsLanded]);

  const spawnOffsets = useMemo(() => {
    if (!cityPositions || cityPositions.length === 0 || !svgRef.current) {
      return STAR_FALLBACK_DIRECTIONS;
    }

    const svgRect = svgRef.current.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) {
      return STAR_FALLBACK_DIRECTIONS;
    }

    const viewBoxW = 7039;
    const viewBoxH = 3567;
    const scaleX = viewBoxW / svgRect.width;
    const scaleY = viewBoxH / svgRect.height;

    const cityMap = new Map(cityPositions.map(c => [c.name, c]));

    return STAR_CITY_MAP.map((cityName, i) => {
      const city = cityMap.get(cityName);
      if (!city) return STAR_FALLBACK_DIRECTIONS[i];

      const relX = city.x - svgRect.left;
      const relY = city.y - svgRect.top;
      const cityInSvgX = relX * scaleX;
      const cityInSvgY = relY * scaleY;

      const rawX = cityInSvgX - STAR_CENTERS[i].x;
      const rawY = cityInSvgY - STAR_CENTERS[i].y;

      // Ensure minimum travel distance for visible flight
      const dist = Math.sqrt(rawX * rawX + rawY * rawY);
      const minDist = 1500;
      if (dist < minDist && dist > 0) {
        const scale = minDist / dist;
        return { x: rawX * scale, y: rawY * scale };
      }

      return { x: rawX, y: rawY };
    });
  }, [cityPositions, starsVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 7039 3567"
      fill="none"
      role="img"
      aria-label="EHL: European Hackathon League"
      className="w-[clamp(280px,35vw,480px)]"
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Comet trail gradient */}
        <linearGradient id="trail-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={CI.jasmine} stopOpacity={0} />
          <stop offset="60%" stopColor={CI.jasmine} stopOpacity={0.5} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0.9} />
        </linearGradient>
      </defs>

      {/* ── STAR FLIGHT & COLLISION ── */}
      <g>
        {STAR_PATHS.map((d, i) => {
          const delay = i * 0.2; // 0.2s stagger: each star individually visible
          const cx = STAR_CENTERS[i].x;
          const cy = STAR_CENTERS[i].y;
          const ox = spawnOffsets[i].x;
          const oy = spawnOffsets[i].y;
          const particles = STAR_PARTICLES[i];

          // Collision happens when star reaches its target: delay + flight duration
          const collisionDelay = delay + 1.0;

          return (
            <g key={`star-group-${i}`}>

              {/* ── Comet trail: line from spawn to target ── */}
              <motion.line
                x1={cx + ox}
                y1={cy + oy}
                x2={cx}
                y2={cy}
                stroke="url(#trail-gradient)"
                strokeWidth={6}
                strokeLinecap="round"
                initial={{ opacity: 0, pathLength: 0 }}
                animate={
                  starsVisible
                    ? {
                        opacity: [0, 0.8, 0.9, 0.4, 0],
                        pathLength: [0, 0.05, 0.5, 1, 1],
                      }
                    : { opacity: 0, pathLength: 0 }
                }
                transition={{
                  duration: 1.3,
                  delay,
                  times: [0, 0.05, 0.4, 0.8, 1],
                  ease: "easeOut",
                }}
              />

              {/* ── Ghost trail: blurred copies trailing behind the star ── */}
              {[0.15, 0.10, 0.06].map((trailDelay, ti) => (
                <motion.circle
                  key={`ghost-${i}-${ti}`}
                  cx={cx}
                  cy={cy}
                  r={40 - ti * 10}
                  fill={CI.jasmine}
                  initial={{
                    opacity: 0,
                    x: ox,
                    y: oy,
                  }}
                  animate={
                    starsVisible
                      ? {
                          opacity: [0, 0.3 - ti * 0.08, 0],
                          x: 0,
                          y: 0,
                        }
                      : { opacity: 0, x: ox, y: oy }
                  }
                  transition={{
                    duration: 1.2,
                    delay: delay + trailDelay,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={{ filter: "blur(100px)" }}
                />
              ))}

              {/* ── The star itself: flies in with decisive physics ── */}
              <motion.path
                d={d}
                fill={CI.jasmine}
                style={starsVisible && !starsLanded ? { filter: `drop-shadow(0 0 50px ${CI.jasmine})` } : undefined}
                initial={{
                  opacity: 0,
                  x: ox,
                  y: oy,
                  scale: 0.2,
                }}
                animate={
                  starsVisible
                    ? {
                        opacity: 1,
                        x: 0,
                        y: 0,
                        scale: 1,
                      }
                    : {
                        opacity: 0,
                        x: ox,
                        y: oy,
                        scale: 0.2,
                      }
                }
                transition={{
                  // The star flight: fast ease-out ("thrown with force")
                  duration: 1.2,
                  delay,
                  ease: [0.16, 1, 0.3, 1],
                  // Scale overshoots on impact then settles
                  scale: {
                    duration: 1.5,
                    delay,
                    ease: [0.16, 1, 0.3, 1],
                    // Keyframes: small during flight, overshoots on impact, bounces, settles
                    type: "spring",
                    stiffness: 400,
                    damping: 20,
                    mass: 0.6,
                  },
                }}
              />

              {/* ── Collision flash: bright bloom at impact point ── */}
              <motion.circle
                cx={cx}
                cy={cy}
                r={250}
                fill={CI.jasmine}
                initial={{ opacity: 0, scale: 0 }}
                animate={
                  starsVisible
                    ? {
                        opacity: [0, 0, 1, 0.5, 0],
                        scale: [0, 0, 2, 2.5, 0],
                      }
                    : { opacity: 0, scale: 0 }
                }
                transition={{
                  duration: 0.8,
                  delay: collisionDelay - 0.15,
                  times: [0, 0.1, 0.2, 0.5, 1],
                  ease: "easeOut",
                }}
                style={{ filter: "blur(100px)", transformOrigin: `${cx}px ${cy}px` }}
              />

              {/* ── Shockwave ring 1: fast expanding ring ── */}
              <motion.circle
                cx={cx}
                cy={cy}
                r={60}
                fill="none"
                stroke={CI.jasmine}
                strokeWidth={4}
                initial={{ opacity: 0, scale: 0 }}
                animate={
                  starsVisible
                    ? {
                        opacity: [0, 0, 0.9, 0.4, 0],
                        scale: [0, 0, 1, 4, 7],
                      }
                    : { opacity: 0, scale: 0 }
                }
                transition={{
                  duration: 0.9,
                  delay: collisionDelay - 0.1,
                  times: [0, 0.1, 0.15, 0.5, 1],
                  ease: "easeOut",
                }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />

              {/* ── Shockwave ring 2: slower, wider ── */}
              <motion.circle
                cx={cx}
                cy={cy}
                r={40}
                fill="none"
                stroke={CI.platinum}
                strokeWidth={2}
                initial={{ opacity: 0, scale: 0 }}
                animate={
                  starsVisible
                    ? {
                        opacity: [0, 0, 0.5, 0.15, 0],
                        scale: [0, 0, 1, 5, 10],
                      }
                    : { opacity: 0, scale: 0 }
                }
                transition={{
                  duration: 1.2,
                  delay: collisionDelay,
                  times: [0, 0.08, 0.12, 0.5, 1],
                  ease: "easeOut",
                }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />

              {/* ── Particle debris: CERN-style micro particles ── */}
              {particles.map((p, pi) => (
                <motion.circle
                  key={`p-${i}-${pi}`}
                  cx={cx}
                  cy={cy}
                  r={p.size}
                  fill={p.bright ? "#ffffff" : CI.jasmine}
                  initial={{ opacity: 0, x: 0, y: 0, scale: 1 }}
                  animate={
                    starsVisible
                      ? {
                          opacity: [0, 0, 1, 0.6, 0],
                          x: [0, 0, Math.cos(p.angle) * p.dist * 0.3, Math.cos(p.angle) * p.dist],
                          y: [0, 0, Math.sin(p.angle) * p.dist * 0.3, Math.sin(p.angle) * p.dist],
                          scale: [1, 1, 1, 0],
                        }
                      : { opacity: 0, x: 0, y: 0, scale: 1 }
                  }
                  transition={{
                    duration: p.duration + 0.3,
                    delay: collisionDelay + p.delayOffset,
                    times: [0, 0.05, 0.15, 0.6, 1],
                    ease: [0.32, 0, 0.67, 0],
                  }}
                />
              ))}

              {/* ── Curved spiral track (2 per star): CERN-like helical debris ── */}
              {[0, 1].map((t) => {
                const angle = (t === 0 ? 0.3 : 0.8) * Math.PI * 2 + i * 1.1;
                const r = 200 + t * 100;
                // Spiral path: a quadratic curve that arcs away from impact
                const endX = cx + Math.cos(angle) * r;
                const endY = cy + Math.sin(angle) * r;
                const ctrlX = cx + Math.cos(angle + 0.5) * r * 0.7;
                const ctrlY = cy + Math.sin(angle + 0.5) * r * 0.7;
                return (
                  <motion.path
                    key={`spiral-${i}-${t}`}
                    d={`M${cx},${cy} Q${ctrlX},${ctrlY} ${endX},${endY}`}
                    fill="none"
                    stroke={CI.jasmine}
                    strokeWidth={t === 0 ? 3 : 2}
                    strokeLinecap="round"
                    initial={{ opacity: 0, pathLength: 0 }}
                    animate={
                      starsVisible
                        ? {
                            opacity: [0, 0, 0.7, 0],
                            pathLength: [0, 0, 1, 1],
                          }
                        : { opacity: 0, pathLength: 0 }
                    }
                    transition={{
                      duration: 0.7,
                      delay: collisionDelay + 0.02 * t,
                      times: [0, 0.05, 0.4, 1],
                      ease: "easeOut",
                    }}
                  />
                );
              })}
            </g>
          );
        })}

        {/* ── Star idle: multi-frequency breathing ── */}
        {isComplete && isInView &&
          STAR_PATHS.map((d, i) => (
            <motion.path
              key={`idle-${i}`}
              d={d}
              fill={CI.jasmine}
              animate={{
                // Each star at a different amplitude + frequency for organic feel
                opacity: [1, 0.85 - (i % 2) * 0.05, 1, 0.9, 1],
                scale: [1, 1 + 0.03 + (i % 3) * 0.015, 1, 1 + 0.02 + (i % 2) * 0.01, 1],
              }}
              transition={{
                duration: 3.5 + i * 0.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.5,
              }}
              style={{ transformOrigin: `${STAR_CENTERS[i].x}px ${STAR_CENTERS[i].y}px` }}
            />
          ))}

        {/* ── Star idle glow: slow pulsing halo ── */}
        {isComplete && isInView &&
          STAR_PATHS.map((d, i) => (
            <motion.path
              key={`star-halo-${i}`}
              d={d}
              fill={CI.jasmine}
              style={{ filter: "blur(40px)" }}
              animate={{
                opacity: [0.1, 0.2, 0.1],
              }}
              transition={{
                duration: 4 + i * 0.6,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.3,
              }}
            />
          ))}
      </g>

      {/* ── WORDMARK: neon sign power-up ── */}
      <g>
        {(["E", "H", "L"] as const).map((letter, i) => (
          <g key={letter}>
            {/* Neon glow layer (appears during flicker) */}
            <motion.path
              d={LETTER_PATHS[letter]}
              fill={CI.platinum}
              style={{ filter: "blur(20px)" }}
              initial={{ opacity: 0 }}
              animate={
                wordmarkVisible
                  ? { opacity: FLICKER_OPACITY.map(v => v * 0.4) }
                  : { opacity: 0 }
              }
              transition={
                wordmarkVisible
                  ? {
                      duration: FLICKER_DURATION,
                      delay: i * 0.2,
                      times: FLICKER_TIMES,
                      ease: "linear",
                    }
                  : { duration: 0.15 }
              }
            />
            {/* The letter itself */}
            <motion.path
              d={LETTER_PATHS[letter]}
              fill={CI.platinum}
              initial={{ opacity: 0 }}
              animate={
                wordmarkVisible
                  ? { opacity: FLICKER_OPACITY }
                  : { opacity: 0 }
              }
              transition={
                wordmarkVisible
                  ? {
                      duration: FLICKER_DURATION,
                      delay: i * 0.2,
                      times: FLICKER_TIMES,
                      ease: "linear",
                    }
                  : { duration: 0.15 }
              }
            />
          </g>
        ))}

        {/* ── Letter idle: micro-flicker + breathing glow ── */}
        {isComplete && isInView &&
          (["E", "H", "L"] as const).map((letter, i) => (
            <g key={`idle-${letter}`}>
              {/* Micro-flicker: irregular, rare power fluctuations */}
              <motion.path
                d={LETTER_PATHS[letter]}
                fill={CI.platinum}
                animate={{
                  opacity: [1, 1, 0.92, 1, 1, 1, 0.95, 1, 1, 0.88, 1, 1, 1],
                }}
                transition={{
                  duration: 7 + i * 2.5,
                  repeat: Infinity,
                  ease: "linear",
                  times: [0, 0.1, 0.12, 0.15, 0.35, 0.55, 0.57, 0.60, 0.78, 0.80, 0.83, 0.95, 1],
                }}
              />
              {/* Ambient neon glow: slow breathing */}
              <motion.path
                d={LETTER_PATHS[letter]}
                fill={CI.platinum}
                style={{ filter: "blur(40px)" }}
                animate={{
                  opacity: [0.04, 0.1, 0.04],
                }}
                transition={{
                  duration: 4 + i * 0.8,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </g>
          ))}
      </g>
    </svg>
  );
}
