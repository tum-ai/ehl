import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/actions/auth";

/**
 * Verify the request comes from an authenticated admin.
 * Returns null if authorized, or a 403 NextResponse if not.
 *
 * Usage in API routes:
 *   const denied = await requireAdmin();
 *   if (denied) return denied;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

/**
 * Verify the caller is an authenticated admin (for server actions).
 * Returns an error string if not authorized, or null if OK.
 *
 * Usage in server actions:
 *   const adminError = await requireAdminAction();
 *   if (adminError) return { error: adminError };
 */
/**
 * Verify the caller is an authenticated admin (for Server Component pages).
 * Redirects to /admin/login if not authorized. Call at the top of admin pages
 * as defense-in-depth behind middleware.
 */
export async function requireAdminPage(): Promise<void> {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    redirect("/admin/login");
  }
}

export async function requireAdminAction(): Promise<string | null> {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return "Admin access required.";
  }
  return null;
}
