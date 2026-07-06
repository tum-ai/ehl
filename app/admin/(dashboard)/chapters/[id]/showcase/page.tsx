import { notFound } from "next/navigation";
import Link from "next/link";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";
import { getChapterByIdAdmin } from "@/lib/queries";
import { getOrCreateShowcase } from "@/lib/actions/showcase";
import { getShowcaseCounts } from "@/lib/queries/showcase";
import { getSiteUrl } from "@/lib/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";
import { ShowcaseAdminClient } from "./showcase-client";

export default async function AdminChapterShowcasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChapterAdminPage(id);

  // The photos page (and its APIs) are global-admin only, so the pointer card
  // is hidden from chapter admins (same gating as the Manage card's global
  // items) — and the photo count below is only fetched when it will be shown.
  const session = await getSession();
  const isGlobalAdmin = session?.profile?.role === "admin";

  // Independent fetches — run together. getOrCreateShowcase lazily creates the
  // row on first view so the admin always sees a usable link. The photo count
  // is a head-only COUNT (photos are ONE per-chapter pool shown both here and
  // on the public completed page; they are MANAGED on the Photos page, this
  // page only points there — one pool, one home).
  const [chapter, settings, counts, photoCountRes] = await Promise.all([
    getChapterByIdAdmin(id),
    getOrCreateShowcase(id),
    getShowcaseCounts(id),
    isGlobalAdmin
      ? createAdminClient()
          .from("media")
          .select("id", { count: "exact", head: true })
          .eq("chapter_id", id)
          .eq("type", "photo")
      : Promise.resolve(null),
  ]);
  if (!chapter) notFound();
  if ("error" in settings) {
    // The page guard already passed, so an error here is unexpected; surface it.
    throw new Error(settings.error);
  }
  if (photoCountRes?.error) throw photoCountRes.error;
  const photoCount = photoCountRes?.count ?? 0;

  const showcaseUrl = `${getSiteUrl()}/showcase/${settings.token}`;

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

      {/* Photos are one per-chapter pool (partner showcase + public completed
          page), managed in one place: the Photos page. This card only tells
          the operator what the showcase gallery will contain and links there. */}
      {isGlobalAdmin && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="ad-heading text-lg">Photos</h2>
              <p className="mt-1 text-sm ad-text-secondary">
                {photoCount === 0
                  ? "No photos yet: the showcase gallery section stays hidden until photos are uploaded."
                  : `${photoCount} photo${photoCount === 1 ? "" : "s"} will appear in the showcase gallery.`}{" "}
                Photos are shared with the public chapter page and managed on the
                Photos page.
              </p>
            </div>
            <Link
              href={`/admin/chapters/${id}/photos`}
              className="shrink-0 rounded-lg border ad-border px-4 py-2.5 text-sm font-bold transition-colors ad-bg-card-hover"
            >
              Manage photos &rarr;
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
