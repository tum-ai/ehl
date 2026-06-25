import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import {
  getChapterBySlug,
  resolveJuryAssignment,
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

  // A juror may be assigned to multiple challenges in the same chapter, so
  // resolve by the specific challenge id when provided.
  const challengeId = searchParams.get("challengeId");
  const assignment = await resolveJuryAssignment(
    session.user.id,
    chapter.id,
    challengeId
  );

  if (!assignment) {
    return NextResponse.json({ error: "No assignment" }, { status: 404 });
  }

  return NextResponse.json(assignment);
}
