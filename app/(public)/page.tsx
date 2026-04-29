import type { Metadata } from "next";
import { HeroSection } from "@/components/hero/Hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MediaTeaser } from "@/components/landing/media-teaser";
import { LandingPodium } from "@/components/podium/LandingPodium";
import { TourTimeline } from "@/components/landing/tour-timeline";
import { PartnersBar } from "@/components/landing/partners-bar";
import { ApplicationBanner } from "@/components/landing/application-banner";
import { getLeaderboard, getChapters } from "@/lib/queries";

export const metadata: Metadata = {
  title: "European Hackathon League | Europe's First Competitive Hackathon League",
  description:
    "6 matches. 4 cities. One champion. Join Europe's first competitive hackathon league with teams from Munich, Paris, Berlin, and Zurich.",
  alternates: { canonical: "https://ehl.gg" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  name: "European Hackathon League",
  alternateName: "EHL",
  url: "https://ehl.gg",
  logo: "https://ehl.gg/images/ehl-logo.png",
  description:
    "Europe's first competitive hackathon league. 6 matches across Europe. One leaderboard. One champion.",
  foundingDate: "2026",
  founder: {
    "@type": "Organization",
    name: "TUM.ai",
    url: "https://tum-ai.com",
  },
  sport: "Hackathon",
  location: [
    { "@type": "City", name: "Munich" },
    { "@type": "City", name: "Paris" },
    { "@type": "City", name: "Berlin" },
    { "@type": "City", name: "Zurich" },
  ],
};

export default async function Home() {
  const [leaderboard, chapters] = await Promise.all([
    getLeaderboard(),
    getChapters(),
  ]);
  const openChapter = chapters.find((c) => c.status === "applications_open");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HeroSection applyHref={openChapter ? `/apply/${openChapter.slug}` : undefined} />
      <ApplicationBanner />
      <HowItWorks />
      <TourTimeline />
      <LandingPodium entries={leaderboard} />
      <MediaTeaser />
      <PartnersBar />
    </>
  );
}
