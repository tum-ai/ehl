import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface JuryInviteEmailProps {
  name: string;
  inviteLink: string;
  challengeName?: string;
}

export function JuryInviteEmail({ name, inviteLink, challengeName }: JuryInviteEmailProps) {
  return (
    <EmailLayout preview="You've been invited to judge at the European Hackathon League">
      <Heading>Jury Invitation</Heading>

      <Text>
        Hey {name}, you have been invited to join the <strong style={{ color: "#E8B84B" }}>European Hackathon League</strong> as
        a jury member{challengeName ? (
          <> for the <strong style={{ color: "#E8B84B" }}>{challengeName}</strong> challenge</>
        ) : null}.
      </Text>

      <Text>
        As a jury member, you will review team submissions, watch pitches, and submit your
        individual ranking of the top teams.
      </Text>

      <Button href={inviteLink}>Accept Invitation</Button>

      <Text muted>
        This link will log you into the jury portal. If the button does not work, copy and paste
        this URL into your browser:
      </Text>

      <Text muted>
        <a href={inviteLink} style={{ color: "#9B59B6", wordBreak: "break-all" as const }}>
          {inviteLink}
        </a>
      </Text>

      <Divider />

      <Text muted>
        If you did not expect this invitation, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}
