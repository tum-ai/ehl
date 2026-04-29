import Link from "next/link";
import { Section, SectionTitle } from "@/components/ui/section";
import { Podium } from "@/components/leaderboard/podium";
import { getLeaderboard } from "@/lib/queries";

export async function LeaderboardPreview() {
  const leaderboard = await getLeaderboard();

  return (
    <Section className="relative overflow-hidden">
      {/* Background glow */}
      <div className="glow-blob glow-blob-gold absolute -right-60 top-0 h-[400px] w-[400px] opacity-20" />
      <div className="glow-blob glow-blob-purple absolute -left-40 top-1/2 h-[300px] w-[300px] opacity-15" />

      <SectionTitle>Leaderboard</SectionTitle>

      <Podium entries={leaderboard} compact />

      <div className="mt-12 text-center">
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-gold transition-all duration-200 hover:text-gold-light hover:drop-shadow-[0_0_12px_rgba(255,204,106,0.3)]"
        >
          Full Leaderboard
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    </Section>
  );
}
