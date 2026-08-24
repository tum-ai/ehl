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
      {/* min-w-0: a flex item defaults to min-width:auto, so <main> could not
          shrink below its widest child and pushed the whole PAGE sideways
          instead of letting the table's own overflow-x container scroll. That
          is why the admin Teams page ran past the right edge and hid its
          Actions column. Every admin page inherits the fix. */}
      <main className="admin-light ad-body min-w-0 flex-1 pt-14 md:pt-0 md:pl-56">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
