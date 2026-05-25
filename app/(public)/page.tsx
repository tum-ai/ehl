import type { Metadata } from "next";
import { HeroSection } from "@/components/hero/Hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MediaTeaser } from "@/components/landing/media-teaser";
import { LandingPodium } from "@/components/podium/LandingPodium";
import { TourTimeline } from "@/components/landing/tour-timeline";
import { PartnersBar } from "@/components/landing/partners-bar";
import { getLeaderboard, getChapters, getChapterStats } from "@/lib/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { totalMatches, cityNames } = await getChapterStats();
  const cities = cityNames.join(", ");
  return {
    title: "European Hackathon League | Europe's First Competitive Hackathon League",
    description: `${totalMatches} matches. ${cityNames.length} cities. One champion. Join Europe's first competitive hackathon league with teams from ${cities}.`,
    alternates: { canonical: "https://ehl.gg" },
  };
}

export default async function Home() {
  const [leaderboard, chapters, stats] = await Promise.all([
    getLeaderboard(),
    getChapters(),
    getChapterStats(),
  ]);
  const openChapter = chapters.find((c) => c.status === "applications_open");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: "European Hackathon League",
    alternateName: "EHL",
    url: "https://ehl.gg",
    logo: "https://ehl.gg/images/ehl-logo.png",
    description: `Europe's first competitive hackathon league. ${stats.totalMatches} matches across Europe. One leaderboard. One champion.`,
    foundingDate: "2026",
    founder: {
      "@type": "Organization",
      name: "TUM.ai",
      url: "https://tum-ai.com",
    },
    sport: "Hackathon",
    location: stats.cityNames.map((name) => ({ "@type": "City", name })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HeroSection
        applyHref={openChapter ? `/apply/${openChapter.slug}` : undefined}
        applyChapterName={openChapter?.name}
        totalMatches={stats.totalMatches}
        totalCities={stats.cities}
        cityNames={stats.cityNames}
      />
      <HowItWorks />
      <TourTimeline />
      <LandingPodium entries={leaderboard} />
      <MediaTeaser />
      <PartnersBar />
    </>
  );
}
