import { NextResponse } from "next/server";
import { getTeamMembersWithProfiles } from "@/lib/queries";
import { getCheckinStatusForUsers } from "@/lib/queries/checkin";
import { checkRateLimit, apiLimiter } from "@/lib/ratelimit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(apiLimiter, `members:${ip}`);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id } = await params;
  const members = await getTeamMembersWithProfiles(id);

  const url = new URL(request.url);
  const chapterId = url.searchParams.get("chapterId");

  // When chapterId is provided, include check-in status per member
  let checkinMap: Map<string, boolean> | null = null;
  if (chapterId) {
    const userIds = members.map((m) => m.userId);
    checkinMap = await getCheckinStatusForUsers(userIds, chapterId);
  }

  return NextResponse.json(
    members.map((m) => ({
      userId: m.userId,
      name: m.profile?.name ?? "Unknown",
      role: m.role,
      ...(checkinMap ? { checkedIn: checkinMap.get(m.userId) ?? false } : {}),
    }))
  );
}
