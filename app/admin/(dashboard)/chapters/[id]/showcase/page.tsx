import { notFound } from "next/navigation";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";
import { getChapterByIdAdmin } from "@/lib/queries";
import { getOrCreateShowcase } from "@/lib/actions/showcase";
import { getShowcaseCounts } from "@/lib/queries/showcase";
import { getSiteUrl } from "@/lib/utils";
import { ShowcaseAdminClient } from "./showcase-client";
import { ChapterPhotosManager } from "@/components/admin/chapter-photos-manager";

export default async function AdminChapterShowcasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChapterAdminPage(id);

  // Independent fetches — run together. getOrCreateShowcase lazily creates the
  // row on first view so the admin always sees a usable link.
  const [chapter, settings, counts] = await Promise.all([
    getChapterByIdAdmin(id),
    getOrCreateShowcase(id),
    getShowcaseCounts(id),
  ]);
  if (!chapter) notFound();
  if ("error" in settings) {
    // The page guard already passed, so an error here is unexpected; surface it.
    throw new Error(settings.error);
  }

  const showcaseUrl = `${getSiteUrl()}/showcase/${settings.token}`;

  // The photo APIs/actions are global-admin only, so the embedded manager is
  // hidden from chapter admins (same gating as the Manage card's global items).
  const session = await getSession();
  const isGlobalAdmin = session?.profile?.role === "admin";

  return (
    <div>
      <ShowcaseAdminClient
        chapterId={id}
        chapterName={chapter.name}
        showcaseUrl={showcaseUrl}
        isEnabled={settings.isEnabled}
        showCvs={settings.showCvs}
        expiresAt={settings.expiresAt}
        counts={counts}
      />

      {/* Photos shown to partners: managed right where the sponsor link is
          managed, so the whole sponsor-facing setup lives on one page. */}
      {isGlobalAdmin && (
        <div className="mt-10">
          <h2 className="ad-heading mb-1 text-lg">Photos</h2>
          <p className="mb-4 text-sm ad-text-secondary">
            These photos appear in the showcase gallery immediately, and on the
            public chapter page once the match is completed.
          </p>
          <ChapterPhotosManager chapterId={id} chapterName={chapter.name} />
        </div>
      )}
    </div>
  );
}
