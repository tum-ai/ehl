import { NextResponse } from "next/server";
import { getChallengesForChapter } from "@/lib/queries";
import { checkRateLimit, apiLimiter } from "@/lib/ratelimit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(apiLimiter, `challenges:${ip}`);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id } = await params;
  const challenges = await getChallengesForChapter(id);

  return NextResponse.json(
    challenges.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      sponsorName: c.sponsorName,
    }))
  );
}
