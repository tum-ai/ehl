import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/sidebar";
import { getSession } from "@/lib/actions/auth";
import { getAdminChapterId } from "@/lib/chapter-admin";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Admit global admins and local (chapter) admins; page-level guards confine
  // local admins to their single chapter.
  const session = await getSession();
  const role = session?.profile?.role;

  if (!session || (role !== "admin" && role !== "chapter_admin")) {
    redirect("/admin/login");
  }

  const chapterId =
    role === "chapter_admin" ? await getAdminChapterId(session.user.id) : null;

  return (
    <div className="flex min-h-screen">
      <AdminSidebar role={role} chapterId={chapterId} />
      <main className="admin-light ad-body flex-1 pt-14 md:pt-0 md:pl-56">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
