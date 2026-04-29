import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface JoinRequestEmailProps {
  captainName: string;
  requesterName: string;
  requesterEmail: string;
  teamName: string;
}

export function JoinRequestEmail({
  captainName,
  requesterName,
  requesterEmail,
  teamName,
}: JoinRequestEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";
  const dashboardUrl = `${baseUrl}/dashboard`;

  return (
    <EmailLayout preview={`${requesterName} wants to join ${teamName}`}>
      <Heading>
        New Join Request
      </Heading>

      <Text>
        Hey {captainName}, <strong style={{ color: "#E8B84B" }}>{requesterName}</strong> ({requesterEmail})
        wants to join your team <strong style={{ color: "#E8B84B" }}>{teamName}</strong>.
      </Text>

      <Text>
        Go to your dashboard to accept or decline this request.
      </Text>

      <Button href={dashboardUrl}>
        Open Dashboard
      </Button>

      <Divider />

      <Text muted>
        You received this email because you are the president of {teamName} and have
        marked your team as looking for members.
      </Text>
    </EmailLayout>
  );
}
