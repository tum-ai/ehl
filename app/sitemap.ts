import type { MetadataRoute } from "next";
import { getChapters } from "@/lib/queries";

const BASE_URL = "https://ehl.gg";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const chapters = await getChapters();

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE_URL}/matches`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/leaderboard`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/rules`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/partners`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const chapterPages: MetadataRoute.Sitemap = chapters.map((chapter) => ({
    url: `${BASE_URL}/matches/${chapter.slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const applyPages: MetadataRoute.Sitemap = chapters
    .filter((c) => c.status === "applications_open")
    .map((chapter) => ({
      url: `${BASE_URL}/apply/${chapter.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

  return [...staticPages, ...chapterPages, ...applyPages];
}
