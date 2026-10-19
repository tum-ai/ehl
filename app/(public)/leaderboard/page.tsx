import type { Metadata } from "next";
import { Section, SectionTitle } from "@/components/ui/section";
import { FinaleWinnersPodium } from "@/components/podium/FinaleWinnersPodium";
import { LeaderboardTable } from "@/components/leaderboard/table";
import { ScoringExplainer } from "@/components/leaderboard/scoring-explainer";
import { getLeaderboard, getCompletedChaptersCount, getChapterStats } from "@/lib/queries";
import { LimitBanner } from "@/components/ui/limit-banner";
import { QUERY_LIMITS } from "@/lib/config/limits";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Current standings for the European Hackathon League",
};

export default async function LeaderboardPage() {
  const [leaderboard, completedCount, stats] = await Promise.all([
    getLeaderboard(),
    getCompletedChaptersCount(),
    getChapterStats(),
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
          {completedCount} of {stats.totalMatches} matches completed
        </p>
      </div>

      {/* Grand Finale winners (hardcoded in lib/finale.ts), with glow backdrop */}
      <div className="relative mb-20">
        <SectionTitle>Grand Finale Champions</SectionTitle>
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-64 bg-[radial-gradient(ellipse_at_center,rgba(255,204,106,0.06)_0%,transparent_70%)]" />
        <FinaleWinnersPodium />
      </div>

      {/* Season points table: the ranking teams carried into the finale */}
      <SectionTitle>EHL Ranking going into the Finale</SectionTitle>
      <LimitBanner count={leaderboard.length} limit={QUERY_LIMITS.leaderboard} label="teams" />
      <LeaderboardTable entries={leaderboard} />

      {/* Scoring explainer */}
      <ScoringExplainer />
    </Section>
  );
}
