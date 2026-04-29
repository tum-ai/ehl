import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import { getMyJuryRanking } from "@/lib/queries";

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
  const challengeId = searchParams.get("challengeId");
  if (!challengeId) {
    return NextResponse.json({ error: "Missing challengeId" }, { status: 400 });
  }

  const ranking = await getMyJuryRanking(challengeId, session.user.id);
  return NextResponse.json(ranking);
}
