import { notFound } from "next/navigation";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import { getChapterByIdAdmin } from "@/lib/queries";
import { getOrCreateShowcase } from "@/lib/actions/showcase";
import { getShowcaseCounts } from "@/lib/queries/showcase";
import { getSiteUrl } from "@/lib/utils";
import { ShowcaseAdminClient } from "./showcase-client";

export default async function AdminChapterShowcasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChapterAdminPage(id);

  const chapter = await getChapterByIdAdmin(id);
  if (!chapter) notFound();

  // Lazily create the row on first view so the admin always sees a usable link.
  const settings = await getOrCreateShowcase(id);
  if ("error" in settings) {
    // The page guard already passed, so an error here is unexpected; surface it.
    throw new Error(settings.error);
  }

  const counts = await getShowcaseCounts(id);
  const showcaseUrl = `${getSiteUrl()}/showcase/${settings.token}`;

  return (
    <ShowcaseAdminClient
      chapterId={id}
      chapterName={chapter.name}
      showcaseUrl={showcaseUrl}
      isEnabled={settings.isEnabled}
      showCvs={settings.showCvs}
      expiresAt={settings.expiresAt}
      counts={counts}
    />
  );
}
