import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { ApplicationForm } from "@/components/application/application-form";
import { getChapterBySlug, getTeamForUser } from "@/lib/queries";
import { getMyPreviousApplication } from "@/lib/actions/applications";
import { getSession } from "@/lib/actions/auth";

interface PageProps {
  params: Promise<{ "chapter-slug": string }>;
}

// No generateStaticParams: the apply page must reflect the chapter's current
// status on every request. A prebuilt/cached entry could keep showing the form
// for a minute or two after the deadline closes applications, which is exactly
// the stale-form window we need to avoid. `dynamic = "force-dynamic"` below makes
// every hit server-render fresh.

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { "chapter-slug": slug } = await params;
  const chapter = await getChapterBySlug(slug);
  if (!chapter) return { title: "Not Found" };
  return {
    title: `Apply: ${chapter.name}`,
    description: `Apply to compete in ${chapter.name} in ${chapter.city}, ${chapter.country}.`,
  };
}

export const dynamic = "force-dynamic";

export default async function ApplyPage({ params }: PageProps) {
  const { "chapter-slug": slug } = await params;
  const chapter = await getChapterBySlug(slug);

  if (!chapter) {
    notFound();
  }

  if (chapter.status !== "applications_open") {
    return (
      <Section>
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-hero-display text-3xl font-black sm:text-4xl">Applications Closed</h1>
          <p className="mt-4 font-hero-body text-text-secondary">
            Applications for {chapter.name} are not currently open.
          </p>
        </div>
      </Section>
    );
  }

  // Check session + previous application data for pre-fill
  const [session, previousApp] = await Promise.all([
    getSession(),
    getMyPreviousApplication(),
  ]);

  // Build userProfile: use previous app data if available, otherwise session profile
  let userProfile: {
    email: string;
    firstName: string;
    lastName: string;
    formData: Record<string, unknown>;
  } | null = null;

  if (previousApp) {
    userProfile = {
      email: previousApp.email,
      firstName: previousApp.firstName,
      lastName: previousApp.lastName,
      formData: previousApp.formData,
    };
  } else if (session?.profile) {
    // Logged in but no previous application: still pass session info
    const nameParts = (session.profile.name || "").split(" ");
    userProfile = {
      email: session.profile.email || "",
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      formData: {},
    };
  }

  // Lookup existing team for logged-in users
  let currentTeam: { teamId: string; teamName: string } | null = null;
  if (session) {
    const membership = await getTeamForUser(session.user.id);
    if (membership) {
      currentTeam = { teamId: membership.team.id, teamName: membership.team.name };
    }
  }

  return (
    <Section>
      <ApplicationForm
        chapterId={chapter.id}
        chapterName={chapter.name}
        chapterSlug={chapter.slug}
        userProfile={userProfile}
        currentTeam={currentTeam}
        requireCv={chapter.requireCv}
        requireMotivation={chapter.requireMotivation}
      />
    </Section>
  );
}
