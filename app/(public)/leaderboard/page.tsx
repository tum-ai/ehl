import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { Podium } from "@/components/leaderboard/podium";
import { LeaderboardTable } from "@/components/leaderboard/table";
import { ScoringExplainer } from "@/components/leaderboard/scoring-explainer";
import { getLeaderboard, getCompletedChaptersCount } from "@/lib/queries";
import { LimitBanner } from "@/components/ui/limit-banner";
import { QUERY_LIMITS } from "@/lib/config/limits";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Current standings for the European Hackathon League",
};

export default async function LeaderboardPage() {
  const [leaderboard, completedCount] = await Promise.all([
    getLeaderboard(),
    getCompletedChaptersCount(),
  ]);

  return (
    <Section className="relative overflow-hidden">
      {/* Noise texture */}
      <div className="noise absolute inset-0" />

      <div className="glow-blob glow-blob-gold absolute -right-40 -top-20 h-[500px] w-[500px] opacity-15" />
      <div className="glow-blob glow-blob-purple absolute -left-40 top-1/3 h-[400px] w-[400px] opacity-15" />

      <div className="relative mb-16 text-center">
        <h1 className="font-hero-display text-4xl font-black sm:text-5xl">
          <span className="shimmer-text">Standings</span>
        </h1>
        <p className="mt-3 font-hero-body text-text-secondary">
          {completedCount} of 6 matches completed
        </p>
      </div>

      {/* Podium with glow backdrop */}
      <div className="relative mb-20">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-64 bg-[radial-gradient(ellipse_at_center,rgba(255,204,106,0.06)_0%,transparent_70%)]" />
        <Podium entries={leaderboard} />
      </div>

      {/* Full table */}
      <LimitBanner count={leaderboard.length} limit={QUERY_LIMITS.leaderboard} label="teams" />
      <LeaderboardTable entries={leaderboard} />

      {/* Scoring explainer */}
      <ScoringExplainer />
    </Section>
  );
}
