import { AdminSidebar } from "@/components/admin/sidebar";
import { requireAdminPage } from "@/lib/admin-auth";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="admin-light ad-body flex-1 pt-14 md:pt-0 md:pl-56">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
