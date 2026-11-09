import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/actions/auth";

/**
 * Resolve the currently authenticated user's id for audit attribution.
 *
 * Reads the same auth-aware server client the require*Action guards use, so when
 * called immediately after a successful requireAdminAction() (or any logged-in
 * path) it reliably returns the acting account's id. It returns
 * null only when there is genuinely no session — which, on an admin-guarded path,
 * should never happen, and the event-log integrity check exists to scream if it
 * somehow does. Use this to populate `actorId` on admin-initiated audit events.
 */
export async function getActingUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

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
