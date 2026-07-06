import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getChapterByIdAdmin } from "@/lib/queries";
import { ChapterStatsPanel } from "@/components/admin/stats/chapter-stats-panel";
import Link from "next/link";
import { ChapterEditWrapper } from "./chapter-edit-wrapper";
import { DeleteChapterButton } from "./delete-chapter-button";
import type { ChapterStatus } from "@/lib/types";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminChapterEditPage({ params }: PageProps) {
  const { id } = await params;
  // Global admins pass for any chapter; local admins only for their own.
  await requireChapterAdminPage(id);

  const session = await getSession();
  const isGlobalAdmin = session?.profile?.role === "admin";

  const chapter = await getChapterByIdAdmin(id);

  if (!chapter) {
    notFound();
  }

  // Show stats panel for chapters that are past the draft/announced stage
  const showStats = !["draft", "announced"].includes(chapter.status);

  // The "Manage" links a local (chapter) admin may use: screening, members,
  // submissions/code-reviews, and the public page. Edit/status/scores/jury/
  // partners/challenges remain global-admin only.
  const manageCard = (
    <Card>
      <h2 className="ad-heading mb-4 text-lg">Manage</h2>
      <div className="space-y-3">
        <Link
          href={`/admin/chapters/${chapter.id}/applications`}
          className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
        >
          <span>Applications</span>
          <span className="ad-text-muted">&rarr;</span>
        </Link>
        <Link
          href={`/admin/chapters/${chapter.id}/members`}
          className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
        >
          <span>Chapter Members</span>
          <span className="ad-text-muted">&rarr;</span>
        </Link>
        <Link
          href={`/admin/chapters/${chapter.id}/communications`}
          className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
        >
          <span>Communications</span>
          <span className="ad-text-muted">&rarr;</span>
        </Link>
        <Link
          href={`/admin/chapters/${chapter.id}/walk-in`}
          className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
        >
          <span>Walk-In Registration</span>
          <span className="ad-text-muted">&rarr;</span>
        </Link>
        <Link
          href={`/admin/chapters/${chapter.id}/showcase`}
          className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
        >
          <span>Partner Showcase</span>
          <span className="ad-text-muted">&rarr;</span>
        </Link>
        {isGlobalAdmin && (
          <Link
            href={`/admin/chapters/${chapter.id}/photos`}
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Photos</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href={`/admin/chapters/${chapter.id}/challenges`}
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Challenges</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href={`/admin/chapters/${chapter.id}/pitch-order`}
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Pitch Order</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href={`/admin/chapters/${chapter.id}/code-reviews`}
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Code Reviews</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href={`/admin/chapters/${chapter.id}/scores`}
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Manage Scores</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href={`/admin/chapters/${chapter.id}/admins`}
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Local Admins</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href="/admin/jury"
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Jury Management</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        {isGlobalAdmin && (
          <Link
            href="/admin/partners"
            className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
          >
            <span>Partners</span>
            <span className="ad-text-muted">&rarr;</span>
          </Link>
        )}
        <Link
          href={`/matches/${chapter.slug}`}
          className="flex items-center justify-between rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
        >
          <span>View Public Page</span>
          <span className="ad-text-muted">&rarr;</span>
        </Link>
      </div>
    </Card>
  );

  return (
    <div>
      <div className="mb-8">
        {isGlobalAdmin && (
          <Link
            href="/admin/chapters"
            className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
          >
            &larr; Back to chapters
          </Link>
        )}
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="ad-title text-2xl">{chapter.name}</h1>
          <p className="mt-1 ad-text-secondary">
            {chapter.city}, {chapter.country}
          </p>
        </div>
        <Badge
          variant={
            chapter.status === "completed"
              ? "completed"
              : chapter.status === "announced"
                ? "announced"
                : "upcoming"
          }
          light
        >
          {chapter.status}
        </Badge>
      </div>

      {/* Chapter stats (shown for chapters past draft/announced) */}
      {showStats && (
        <div className="mt-6">
          <ChapterStatsPanel chapterId={chapter.id} />
        </div>
      )}

      {/* Global admins get the editable status/details controls; local admins
          get a read-only overview with their permitted Manage links. */}
      {isGlobalAdmin ? (
        <ChapterEditWrapper
          chapterId={chapter.id}
          initialStatus={chapter.status as ChapterStatus}
          initialData={{
            name: chapter.name,
            city: chapter.city,
            country: chapter.country,
            description: chapter.description,
            date: chapter.date,
            dateEnd: chapter.dateEnd,
            heroImageUrl: chapter.heroImageUrl,
            photoAlbumUrl: chapter.photoAlbumUrl,
            challengeRegistrationEnabled: chapter.challengeRegistrationEnabled,
            applicationDeadline: chapter.applicationDeadline,
            challengeSelectionDeadline: chapter.challengeSelectionDeadline,
            submissionDeadline: chapter.submissionDeadline,
          }}
        >
          {manageCard}
        </ChapterEditWrapper>
      ) : (
        <div className="mt-8">{manageCard}</div>
      )}

      {/* Destructive delete: global admins only (chapter admins must never
          delete, per CLAUDE.md). */}
      {isGlobalAdmin && (
        <DeleteChapterButton chapterId={chapter.id} chapterName={chapter.name} />
      )}
    </div>
  );
}
