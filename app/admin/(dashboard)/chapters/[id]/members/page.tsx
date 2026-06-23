import { getSession } from "@/lib/actions/auth";
import { requireChapterAdminPage } from "@/lib/admin-auth";
import { AdminChapterMembersClient } from "./members-client";

export default async function AdminChapterMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireChapterAdminPage(id);
  const session = await getSession();
  const isGlobalAdmin = session?.profile?.role === "admin";
  return <AdminChapterMembersClient chapterId={id} isGlobalAdmin={isGlobalAdmin} />;
}
