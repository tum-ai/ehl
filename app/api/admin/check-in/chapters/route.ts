import { NextResponse } from "next/server";
import { toChapter } from "@/lib/queries";
import { getSession } from "@/lib/actions/auth";
import { getAdminChapterId } from "@/lib/chapter-admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Chapters for the check-in dropdown, scoped by role: a global admin sees every
// chapter; a local (chapter) admin sees only their assigned chapter, which
// effectively locks the dropdown to it.
export async function GET() {
  const session = await getSession();
  const role = session?.profile?.role;

  if (role !== "admin" && role !== "chapter_admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  let query = adminClient.from("chapters").select("*").order("match_number");

  if (role === "chapter_admin" && session) {
    const chapterId = await getAdminChapterId(session.user.id);
    if (!chapterId) return NextResponse.json([]);
    query = query.eq("id", chapterId);
  }

  const { data } = await query;
  const chapters = (data ?? []).map((row) =>
    toChapter(row as Record<string, unknown>)
  );
  return NextResponse.json(
    chapters.map((ch) => ({ id: ch.id, name: ch.name, status: ch.status }))
  );
}
