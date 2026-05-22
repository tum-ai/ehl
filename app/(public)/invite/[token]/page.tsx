import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptTeamInvite } from "@/lib/actions/teams";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const adminClient = createAdminClient();

  // Look up the invite
  const { data: invite } = await adminClient
    .from("team_invites")
    .select("id, email, status, expires_at")
    .eq("token", token)
    .single();

  if (!invite || invite.status !== "pending") {
    redirect("/dashboard");
  }

  if (new Date(invite.expires_at as string) < new Date()) {
    await adminClient
      .from("team_invites")
      .update({ status: "expired" })
      .eq("id", invite.id);
    redirect("/dashboard");
  }

  // Check if user is logged in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // User is logged in: auto-accept the invite
    await acceptTeamInvite(token);
    redirect("/dashboard");
  }

  // Not logged in: check if the invited email already has an account
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", (invite.email as string).toLowerCase())
    .single();

  if (existingProfile) {
    // Account exists: send to login, then back here to auto-accept
    redirect(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  }

  // No account: send to register with invite token (existing flow)
  redirect(`/register?invite=${token}`);
}
