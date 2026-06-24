import { notFound } from "next/navigation";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import {
  getChapterByIdAdmin,
  getChapterCommunications,
  getRecentChapterBroadcasts,
} from "@/lib/queries";
import { CommunicationsClient } from "./communications-client";

export default async function AdminChapterCommunicationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChapterAdminPage(id);

  const chapter = await getChapterByIdAdmin(id);
  if (!chapter) notFound();

  const comms = await getChapterCommunications(id);
  const broadcasts = await getRecentChapterBroadcasts(id);

  return (
    <CommunicationsClient
      chapterId={id}
      chapterName={chapter.name}
      initial={{
        acceptanceSubject: comms.acceptanceEmailSubject ?? "",
        acceptanceMessage: comms.acceptanceEmailMessage ?? "",
        eventInfo: comms.eventInfo ?? "",
      }}
      lastBroadcast={
        broadcasts[0]
          ? {
              subject: broadcasts[0].subject,
              recipientCount: broadcasts[0].recipientCount,
              sentAt: broadcasts[0].sentAt,
            }
          : null
      }
    />
  );
}
