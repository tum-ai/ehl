import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Section } from "@/components/ui/section";
import { ConfirmInvite } from "./confirm-invite";
import { getCurrentMembership } from "@/lib/team-membership";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const adminClient = createAdminClient();

  // Look up the invite (+ team name for the confirmation UI)
  const { data: invite } = await adminClient
    .from("team_invites")
    .select("id, email, status, expires_at, team_id, teams(name)")
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

  const teamName =
    ((invite.teams as { name?: string } | null)?.name as string) || "the team";
  const inviteEmail = (invite.email as string).toLowerCase();

  // Check if user is logged in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Logged in with a different email than the invite was sent to: explain,
    // don't silently consume it.
    if ((user.email ?? "").toLowerCase() !== inviteEmail) {
      return (
        <Section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-md text-center">
            <h1 className="text-2xl font-black">Wrong account</h1>
            <p className="mt-3 text-text-secondary">
              This invite was sent to <strong className="text-gold">{inviteEmail}</strong>,
              but you are signed in with a different account. Sign in with the
              invited email to accept it.
            </p>
          </div>
        </Section>
      );
    }

    // Does the user already belong to another team? (informs the confirm copy)
    // A user can hold several team_members rows (Data Integrity 7), so
    // `.maybeSingle()` here used to fail on the multi-row result and return
    // null: the confirm screen then quietly dropped the warning that accepting
    // would remove them from their current team, for exactly the users most
    // likely to need it.
    const existingMembership = await getCurrentMembership(adminClient, user.id);

    const onAnotherTeam =
      !!existingMembership && existingMembership.teamId !== invite.team_id;

    // Explicit confirmation step: accepting is a state change and may remove
    // the user from their current team, so it must be a deliberate click.
    return (
      <ConfirmInvite token={token} teamName={teamName} onAnotherTeam={onAnotherTeam} />
    );
  }

  // Not logged in: check if the invited email already has an account
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", inviteEmail)
    .single();

  if (existingProfile) {
    // Account exists: send to login, then back here to confirm
    redirect(`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  }

  // No account: send to register with invite token (existing flow)
  redirect(`/register?invite=${token}`);
}
