import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { ChapterCompleted } from "@/components/chapter/chapter-completed";
import { ChapterAnnounced } from "@/components/chapter/chapter-announced";
import { ChapterApplicationsOpen } from "@/components/chapter/chapter-applications-open";
import { ChapterRegistrationOpen } from "@/components/chapter/chapter-registration-open";
import { ChapterSubmissionsOpen } from "@/components/chapter/chapter-submissions-open";
import { ChapterPitching } from "@/components/chapter/chapter-pitching";
import {
  getChapters,
  getChapterBySlug,
  getScoresForChapter,
  getTeams,
  getPartnersForChapter,
  getChallengesForChapter,
  getRegistrationForTeam,
  getSubmissionForTeam,
  getMediaForChapter,
} from "@/lib/queries";
import { getSession } from "@/lib/actions/auth";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const chapters = await getChapters();
  return chapters.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const chapter = await getChapterBySlug(slug);
  if (!chapter) return { title: "Not Found" };
  return {
    title: chapter.name,
    description: chapter.description,
  };
}

export const dynamic = "force-dynamic";

export default async function ChapterDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const chapter = await getChapterBySlug(slug);

  if (!chapter) {
    notFound();
  }

  // Always load these
  const [scores, teams, partners, challenges, media] = await Promise.all([
    getScoresForChapter(chapter.id),
    getTeams(),
    getPartnersForChapter(chapter.id),
    getChallengesForChapter(chapter.id),
    getMediaForChapter(chapter.id),
  ]);

  const photos = media.filter((m) => m.type === "photo");

  // Load user-specific data if logged in
  const session = await getSession();
  let teamId: string | null = null;
  let registeredChallengeId: string | null = null;
  let submission = null;
  let isUnlocked = false;
  let userRole: "president" | "member" | null = null;

  if (session) {
    // Find user's team (president or member)
    const { getTeamForUser, getChapterUnlocks } = await import("@/lib/queries");
    const userTeamResult = await getTeamForUser(session.user.id);
    if (userTeamResult) {
      teamId = userTeamResult.team.id;
      userRole = userTeamResult.role;

      // Check if unlocked for this chapter
      const unlocks = await getChapterUnlocks(chapter.id);
      isUnlocked = unlocks.some((u) => u.teamId === teamId);

      // Check registration
      const registration = await getRegistrationForTeam(chapter.id, teamId);
      registeredChallengeId = registration?.challengeId ?? null;

      // Check submission
      if (registeredChallengeId) {
        submission = await getSubmissionForTeam(registeredChallengeId, teamId);
      }
    }
  }

  return (
    <Section>
      {chapter.status === "completed" ? (
        <ChapterCompleted chapter={chapter} scores={scores} teams={teams} partners={partners} photos={photos} />
      ) : chapter.status === "applications_open" ? (
        <ChapterApplicationsOpen chapter={chapter} partners={partners} />
      ) : chapter.status === "preparation" ? (
        <ChapterAnnounced chapter={chapter} screeningMessage="Applications are closed. We are currently reviewing all submissions." />
      ) : chapter.status === "challenge_selection" ? (
        <ChapterRegistrationOpen
          chapter={chapter}
          challenges={challenges}
          isUnlocked={isUnlocked}
          registeredChallengeId={registeredChallengeId}
          userRole={userRole}
          teamId={teamId}
        />
      ) : chapter.status === "hacking" || chapter.status === "submissions_open" ? (
        <ChapterSubmissionsOpen
          chapter={chapter}
          challenges={challenges}
          teamChallengeId={registeredChallengeId}
          submission={submission}
          teamId={teamId}
          userRole={userRole}
        />
      ) : chapter.status === "pitching" ? (
        <ChapterPitching
          chapter={chapter}
          challenges={challenges}
          pitchOrders={await Promise.all(
            challenges.map(async (c) => {
              const { getPitchOrder } = await import("@/lib/queries");
              const order = await getPitchOrder(c.id);
              return order;
            })
          ).then((orders) => orders.filter((o): o is NonNullable<typeof o> => o !== null))}
          teams={teams}
        />
      ) : (
        <ChapterAnnounced chapter={chapter} />
      )}
    </Section>
  );
}
