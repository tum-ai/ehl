import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Exposes member user IDs and per-chapter check-in status, so it must not
  // be anonymously enumerable. Require a session and limit access to a member
  // of the team (or an admin).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: membership } = await adminClient
    .from("team_members")
    .select("user_id")
    .eq("team_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  let allowed = !!membership;
  if (!allowed) {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    allowed = profile?.role === "admin";
  }

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

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
