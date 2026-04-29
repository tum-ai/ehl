import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface TeamInviteEmailProps {
  recipientName: string | null;
  recipientEmail: string;
  teamName: string;
  inviterName: string;
  inviteToken: string;
}

export function TeamInviteEmail({
  recipientName,
  recipientEmail,
  teamName,
  inviterName,
  inviteToken,
}: TeamInviteEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";
  const inviteUrl = `${baseUrl}/register?invite=${inviteToken}`;
  const displayName = recipientName || recipientEmail;

  return (
    <EmailLayout preview={`You've been invited to join ${teamName} in the EHL`}>
      <Heading>
        You&apos;re Invited!
      </Heading>

      <Text>
        Hey {displayName}, <strong style={{ color: "#E8B84B" }}>{inviterName}</strong> has
        invited you to join <strong style={{ color: "#E8B84B" }}>{teamName}</strong> in
        the European Hackathon League.
      </Text>

      <Text>
        Click the button below to create your account and join the team.
        If you already have an EHL account, the invite will be linked automatically when you sign in.
      </Text>

      <Button href={inviteUrl}>
        Join {teamName}
      </Button>

      <Divider />

      <Text muted>
        This invite expires in 14 days. If you did not expect this, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}
