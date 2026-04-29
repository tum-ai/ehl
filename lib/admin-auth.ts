import { NextResponse } from "next/server";
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
export async function requireAdminAction(): Promise<string | null> {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return "Admin access required.";
  }
  return null;
}
