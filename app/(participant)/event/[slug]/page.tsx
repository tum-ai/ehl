import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/actions/auth";
import { getChapterBySlug } from "@/lib/queries";
import { EventHub } from "@/components/event/event-hub";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) {
    // The participant login route is /login (not /auth/login, which 404s).
    redirect(`/login?redirect=/event/${slug}`);
  }

  const chapter = await getChapterBySlug(slug);
  if (!chapter) {
    notFound();
  }

  return (
    <EventHub
      chapterId={chapter.id}
      chapterName={chapter.name}
      chapterSlug={chapter.slug}
    />
  );
}
