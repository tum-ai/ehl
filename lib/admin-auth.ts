import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/actions/auth";
import { getAdminChapterId } from "@/lib/chapter-admin";

/**
 * Resolve the currently authenticated user's id for audit attribution.
 *
 * Reads the same auth-aware server client the require*Action guards use, so when
 * called immediately after a successful requireAdminAction()/requireChapterAdminAction()
 * (or any logged-in path) it reliably returns the acting account's id. It returns
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

// ─── Local (chapter) admin guards ────────────────────────────────────────
//
// Local admins (role "chapter_admin") are scoped to a single chapter via the
// chapter_admins table. Global admins (role "admin") always pass these too.
// The guards above are intentionally left unchanged so every global page,
// action, and API route still admits ONLY global admins.

/**
 * Server Component guard for GLOBAL admin pages (dashboard home, chapters list,
 * teams, admins, logs, settings, etc.). Global admins pass; a local admin is
 * redirected to their own chapter (not the login page, since they ARE
 * authenticated); everyone else goes to /admin/login.
 */
export async function requireGlobalAdminPage(): Promise<void> {
  const session = await getSession();
  const role = session?.profile?.role;
  if (role === "admin") return;
  if (session && role === "chapter_admin") {
    const chapterId = await getAdminChapterId(session.user.id);
    if (chapterId) redirect(`/admin/chapters/${chapterId}`);
  }
  redirect("/admin/login");
}

/**
 * Server Component guard for a chapter-scoped admin page. Global admins pass for
 * any chapter; a local admin passes only for their assigned chapter and is
 * redirected to their own chapter otherwise.
 */
export async function requireChapterAdminPage(chapterId: string): Promise<void> {
  const session = await getSession();
  const role = session?.profile?.role;
  if (role === "admin") return;
  if (session && role === "chapter_admin") {
    const ownChapter = await getAdminChapterId(session.user.id);
    if (ownChapter === chapterId) return;
    if (ownChapter) redirect(`/admin/chapters/${ownChapter}`);
  }
  redirect("/admin/login");
}

/**
 * Server-action guard scoped to a chapter. Returns an error string if the caller
 * is neither a global admin nor a local admin of `chapterId`, else null.
 */
export async function requireChapterAdminAction(
  chapterId: string
): Promise<string | null> {
  const session = await getSession();
  const role = session?.profile?.role;
  if (role === "admin") return null;
  if (session && role === "chapter_admin") {
    const ownChapter = await getAdminChapterId(session.user.id);
    if (ownChapter === chapterId) return null;
  }
  return "Admin access required.";
}

/**
 * API-route guard scoped to a chapter. Returns a 403 NextResponse if the caller
 * is neither a global admin nor a local admin of `chapterId`, else null.
 */
export async function requireChapterAdminApi(
  chapterId: string
): Promise<NextResponse | null> {
  const session = await getSession();
  const role = session?.profile?.role;
  if (role === "admin") return null;
  if (session && role === "chapter_admin") {
    const ownChapter = await getAdminChapterId(session.user.id);
    if (ownChapter === chapterId) return null;
  }
  return NextResponse.json({ error: "Admin access required" }, { status: 403 });
}
