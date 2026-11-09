import { requireAdminPage } from "@/lib/admin-auth";
import { AdminChapterMembersClient } from "./members-client";

export default async function AdminChapterMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminPage();
  return <AdminChapterMembersClient chapterId={id} />;
}
