import { NextResponse } from "next/server";
import { requireChapterAdminApi } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: chapterId } = await params;
  const denied = await requireChapterAdminApi(chapterId);
  if (denied) return denied;

  const adminClient = createAdminClient();

  // Get teams registered for this chapter
  const { data: registrations } = await adminClient
    .from("challenge_registrations")
    .select("team_id")
    .eq("chapter_id", chapterId);

  if (!registrations || registrations.length === 0) {
    return NextResponse.json([]);
  }

  const teamIds = [...new Set(registrations.map((r) => r.team_id as string))];

  // Get team details
  const { data: teams } = await adminClient
    .from("teams")
    .select("id, name")
    .in("id", teamIds);
  const teamMap = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));

  // Get all members of these teams
  const { data: members } = await adminClient
    .from("team_members")
    .select("team_id, user_id, role, profiles!inner(name, email)")
    .in("team_id", teamIds);

  // Get check-in status
  const memberEmails = new Set<string>();
  for (const m of members ?? []) {
    const profile = m.profiles as unknown as { email: string };
    if (profile?.email) memberEmails.add(profile.email.toLowerCase());
  }

  const { data: applications } = await adminClient
    .from("applications")
    .select("email, status")
    .eq("chapter_id", chapterId)
    .in("email", [...memberEmails]);

  const checkedInEmails = new Set(
    (applications ?? [])
      .filter((a) => a.status === "checked_in")
      .map((a) => (a.email as string).toLowerCase())
  );

  // Build response
  const result = (members ?? []).map((m) => {
    const profile = m.profiles as unknown as { name: string | null; email: string };
    return {
      teamId: m.team_id as string,
      teamName: teamMap.get(m.team_id as string) ?? "",
      userId: m.user_id as string,
      name: profile?.name ?? "",
      email: profile?.email ?? "",
      role: m.role as string,
      checkedIn: checkedInEmails.has((profile?.email ?? "").toLowerCase()),
    };
  });

  // Sort: by team name, then president first, then name
  result.sort((a, b) => {
    if (a.teamName !== b.teamName) return a.teamName.localeCompare(b.teamName);
    if (a.role !== b.role) return a.role === "president" ? -1 : 1;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return NextResponse.json(result);
}
