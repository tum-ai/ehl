import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface JuryMagicLinkEmailProps {
  name: string;
  magicLink: string;
}

export function JuryMagicLinkEmail({ name, magicLink }: JuryMagicLinkEmailProps) {
  return (
    <EmailLayout preview="Your EHL jury portal login link">
      <Heading>Jury Portal Login</Heading>

      <Text>
        Hey {name}, click the button below to sign in to the EHL jury portal.
      </Text>

      <Button href={magicLink}>Sign In to Jury Portal</Button>

      <Text muted>
        This link expires in 1 hour. If the button does not work, copy and paste
        this URL into your browser:
      </Text>

      <Text muted>
        <a href={magicLink} style={{ color: "#9B59B6", wordBreak: "break-all" as const }}>
          {magicLink}
        </a>
      </Text>

      <Divider />

      <Text muted>
        If you did not request this login link, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}
