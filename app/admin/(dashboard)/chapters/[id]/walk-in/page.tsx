import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import { getChapterByIdAdmin } from "@/lib/queries";
import { getOrCreateWalkInToken } from "@/lib/actions/walk-in";
import { getSiteUrl } from "@/lib/utils";
import { WalkInClient } from "./walk-in-client";

export default async function AdminChapterWalkInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChapterAdminPage(id);

  const chapter = await getChapterByIdAdmin(id);
  if (!chapter) notFound();

  // Lazily create the row on first view so the admin always sees a usable QR.
  const result = await getOrCreateWalkInToken(id);
  if ("error" in result) {
    // The page guard already passed, so an error here is unexpected; surface it.
    throw new Error(result.error);
  }

  const walkInUrl = `${getSiteUrl()}/walk-in/${result.token}`;
  const qrDataUrl = await QRCode.toDataURL(walkInUrl, {
    width: 600,
    margin: 1,
    color: { dark: "#0B0B1A", light: "#FFFFFF" },
  });

  return (
    <WalkInClient
      chapterId={id}
      chapterName={chapter.name}
      walkInUrl={walkInUrl}
      qrDataUrl={qrDataUrl}
    />
  );
}
