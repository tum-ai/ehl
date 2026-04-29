import Link from "next/link";
import { Section, SectionTitle } from "@/components/ui/section";
import { LandingPodiumClient } from "./LandingPodiumClient";
import type { LeaderboardEntry } from "@/lib/types";

interface LandingPodiumProps {
  entries: LeaderboardEntry[];
}

export function LandingPodium({ entries }: LandingPodiumProps) {
  if (entries.length === 0) return null;

  return (
    <Section className="relative overflow-hidden">
      {/* Background glow */}
      <div className="glow-blob glow-blob-gold absolute -right-60 top-0 h-[400px] w-[400px] opacity-20" />
      <div className="glow-blob glow-blob-purple absolute -left-40 top-1/2 h-[300px] w-[300px] opacity-15" />

      <SectionTitle>Leaderboard</SectionTitle>

      <LandingPodiumClient entries={entries} />

      <div className="mt-12 text-center">
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 font-hero-heading text-sm font-medium text-ci-jasmine transition-all duration-200 hover:text-ci-platinum hover:drop-shadow-[0_0_12px_rgba(255,206,119,0.3)]"
        >
          Full Leaderboard
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </Link>
      </div>
    </Section>
  );
}
