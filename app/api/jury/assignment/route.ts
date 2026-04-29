import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import {
  getChapterBySlug,
  getJuryAssignmentsForUser,
} from "@/lib/queries";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const role = session.profile?.role;
  if (role !== "jury" && role !== "admin") {
    return NextResponse.json({ error: "Jury access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const chapter = await getChapterBySlug(slug);
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  const assignments = await getJuryAssignmentsForUser(session.user.id);
  const assignment = assignments.find((a) => a.chapterId === chapter.id);

  if (!assignment) {
    return NextResponse.json({ error: "No assignment" }, { status: 404 });
  }

  return NextResponse.json(assignment);
}
