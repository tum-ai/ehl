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
