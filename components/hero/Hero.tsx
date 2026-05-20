"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, useReducedMotion, useInView } from "framer-motion";
import dynamic from "next/dynamic";
import { CI, EASING, type HeroPhase } from "@/lib/design-tokens";
import { LogoEHL } from "./LogoEHL";
import { PillButton } from "@/components/ui/PillButton";
import type { CityPosition } from "./MapLayer";

const MapLayer = dynamic(() => import("./MapLayer"), {
  ssr: false,
  loading: () => null,
});

// Timing for each beat (delay from page load, in ms)
// Stars need ~2.5s to fly in and collide (7 stars * 0.2s stagger + 1.2s flight)
// Wordmark flicker needs ~1.2s after stars settle
const BEAT_TIMING: Record<HeroPhase, number> = {
  atmosphere: 0,
  map: 500,
  cities: 1200,
  network: 2000,
  stars: 2800,
  wordmark: 5200,
  tagline: 6600,
  complete: 7200,
};

function useHeroAnimation() {
  const shouldReduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<HeroPhase>(
    shouldReduceMotion ? "complete" : "atmosphere"
  );

  useEffect(() => {
    if (shouldReduceMotion) {
      setPhase("complete");
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    const phases: HeroPhase[] = [
      "map",
      "cities",
      "network",
      "stars",
      "wordmark",
      "tagline",
      "complete",
    ];

    for (const p of phases) {
      timers.push(setTimeout(() => setPhase(p), BEAT_TIMING[p]));
    }

    return () => timers.forEach(clearTimeout);
  }, [shouldReduceMotion]);

  return phase;
}

function useMapDimensions() {
  const [dimensions, setDimensions] = useState({ width: 1280, height: 800 });

  useEffect(() => {
    function update() {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return dimensions;
}

export function HeroSection({ applyHref, applyChapterName }: { applyHref?: string; applyChapterName?: string } = {}) {
  const phase = useHeroAnimation();
  const { width, height } = useMapDimensions();
  const [cityPositions, setCityPositions] = useState<CityPosition[]>([]);
  const logoRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { amount: 0.1 });

  const handleCityPositions = useCallback((positions: CityPosition[]) => {
    setCityPositions(positions);
  }, []);

  return (
    <section
      ref={sectionRef}
      className="hero-animate relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-ci-background"
      aria-label="EHL Hero: Europe's first competitive hackathon league"
    >
      {/* Noise texture */}
      <div className="noise absolute inset-0" />

      {/* Atmospheric glow blobs */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5, ease: EASING.fade }}
      >
        <div
          className="absolute -left-60 -top-60 h-[600px] w-[600px] rounded-full blur-[120px]"
          style={{
            background: `radial-gradient(circle, ${CI.lavender}25, transparent 70%)`,
          }}
        />
        <div
          className="absolute -right-40 top-1/4 h-[500px] w-[500px] rounded-full blur-[120px]"
          style={{
            background: `radial-gradient(circle, ${CI.jasmine}20, transparent 70%)`,
          }}
        />
        <div
          className="absolute -bottom-40 left-1/3 h-[400px] w-[400px] rounded-full blur-[120px]"
          style={{
            background: `radial-gradient(circle, ${CI.darkAmethyst}60, transparent 70%)`,
          }}
        />
      </motion.div>

      {/* Radial depth gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, transparent 0%, ${CI.background} 70%)`,
        }}
      />

      {/* Map layer */}
      <motion.div
        className="absolute inset-0"
        animate={{
          opacity: phase === "complete" ? 0.45 : 0.7,
        }}
        transition={{ duration: 1, ease: "easeInOut" }}
      >
        <MapLayer phase={phase} width={width} height={height} onCityPositions={handleCityPositions} isInView={isInView} />
      </motion.div>

      {/* Content layer — nudged up to visually center despite bottom elements */}
      <div className="relative z-10 -mt-16 flex flex-col items-center px-4 text-center">
        {/* EHL Logo — large overflow-hidden container prevents iOS Safari
            from showing a clipped filter-layer edge on the SVG glows */}
        <motion.div
          ref={logoRef}
          className="overflow-hidden"
          style={{ margin: "-50vh -50vw", padding: "50vh 50vw" }}
          initial={{ opacity: 0 }}
          animate={{
            opacity: phase === "atmosphere" || phase === "map" ? 0 : 1,
          }}
          transition={{ duration: 0.5 }}
        >
          <LogoEHL phase={phase} cityPositions={cityPositions} logoContainerRef={logoRef} isInView={isInView} />
        </motion.div>

        {/* Wordmark subtitle */}
        <motion.p
          className="mt-4 font-hero-body text-[11px] font-bold uppercase tracking-[0.35em] text-ci-platinum/60 sm:text-xs"
          initial={{ opacity: 0 }}
          animate={
            phase === "tagline" || phase === "complete"
              ? { opacity: 1 }
              : { opacity: 0 }
          }
          transition={{
            duration: 0.5,
            ease: EASING.fade,
          }}
        >
          European Hackathon League
        </motion.p>

        {/* Divider */}
        <motion.div
          className="mt-6 h-px w-24 bg-gradient-to-r from-transparent via-ci-lavender/50 to-transparent"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={
            phase === "tagline" || phase === "complete"
              ? { opacity: 1, scaleX: 1 }
              : { opacity: 0, scaleX: 0 }
          }
          transition={{
            duration: 0.6,
            ease: EASING.enter,
          }}
        />

        {/* Tagline */}
        <motion.p
          className="mt-6 max-w-2xl font-hero-body text-3xl font-bold text-ci-platinum sm:text-4xl lg:text-5xl lg:leading-tight"
          initial={{ opacity: 0, y: 15 }}
          animate={
            phase === "tagline" || phase === "complete"
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: 15 }
          }
          transition={{
            duration: 0.6,
            ease: EASING.enter,
          }}
        >
          {"Europe's first competitive "}
          <span className="shimmer-text">
            hackathon league
          </span>
        </motion.p>

        <motion.p
          className="mt-4 max-w-lg font-hero-body text-base text-ci-platinum/70 sm:text-lg"
          initial={{ opacity: 0, y: 10 }}
          animate={
            phase === "tagline" || phase === "complete"
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: 10 }
          }
          transition={{
            duration: 0.5,
            delay: 0.1,
            ease: EASING.enter,
          }}
        >
          6 matches. 4 cities. One champion.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="mt-10 flex flex-col gap-4 sm:flex-row"
          initial={{ opacity: 0, y: 10 }}
          animate={
            phase === "tagline" || phase === "complete"
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: 10 }
          }
          transition={{
            duration: 0.5,
            delay: 0.2,
            ease: EASING.enter,
          }}
        >
          {applyHref ? (
            <PillButton href={applyHref} variant="glow">
              Apply for {applyChapterName}
            </PillButton>
          ) : (
            <PillButton href="/leaderboard" variant="filled">
              View Leaderboard
            </PillButton>
          )}
          <PillButton href="/matches" variant="outline">
            Explore Matches
          </PillButton>
        </motion.div>

        {/* Founded by TUM.ai */}
        <motion.a
          href="https://tum-ai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-ci-platinum/10 bg-ci-platinum/5 px-4 py-1.5 font-hero-body text-xs text-ci-platinum/70 transition-all hover:bg-ci-lavender/10"
          initial={{ opacity: 0 }}
          animate={phase === "complete" ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          Founded by
          <span className="font-bold tracking-wide text-ci-lavender">
            TUM.ai
          </span>
        </motion.a>
      </div>

      {/* Bottom gradient fade to next section */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-surface-deep to-transparent" />

      {/* City footer note */}
      <motion.p
        className="absolute bottom-6 left-6 hidden font-hero-body text-[11px] uppercase tracking-[0.3em] text-ci-platinum/50 lg:block"
        initial={{ opacity: 0 }}
        animate={phase === "complete" ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        Munich &middot; Paris &middot; Berlin &middot; Zurich
      </motion.p>
    </section>
  );
}
