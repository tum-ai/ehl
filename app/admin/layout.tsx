import { AdminSidebar } from "@/components/admin/sidebar";
import { getSession } from "@/lib/actions/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isAuthenticated = session?.profile?.role === "admin";

  if (!isAuthenticated) {
    // No sidebar, just render the login page centered
    return (
      <div className="min-h-screen">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="admin-light ad-body flex-1 pl-56">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
