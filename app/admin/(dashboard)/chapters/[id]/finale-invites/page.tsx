import { notFound } from "next/navigation";
import { requireGlobalAdminPage } from "@/lib/admin-auth";
import { getChapterByIdAdmin } from "@/lib/queries";
import { getFinaleInviteBoard } from "@/lib/actions/finale-invites";
import { FinaleInvitesClient } from "./finale-invites-client";

/**
 * Admin board for the Grand Finale invites.
 *
 * Global admins only: the qualifying teams come from the season leaderboard, so
 * this reaches across every chapter, not just this one's applicants.
 */
export default async function AdminFinaleInvitesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireGlobalAdminPage();

  const chapter = await getChapterByIdAdmin(id);
  if (!chapter) notFound();

  const board = await getFinaleInviteBoard(id);
  if ("error" in board) throw new Error(board.error);

  return (
    <FinaleInvitesClient
      chapterId={id}
      chapterName={chapter.name}
      isFinale={chapter.isFinale}
      teams={board.teams}
      counts={board.counts}
    />
  );
}
