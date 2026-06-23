import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface CreateAccountInviteEmailProps {
  name: string;
  email: string;
  registerUrl: string;
}

/**
 * Sent when someone with an ACCEPTED application (but no account yet) tries to
 * reset their password. They have nothing to reset, so instead of a dead-end (or
 * an enumeration-leaking error in the response) we email them a link to create
 * their account. The forgot-password response stays generic for everyone.
 */
export function CreateAccountInviteEmail({ name, email, registerUrl }: CreateAccountInviteEmailProps) {
  return (
    <EmailLayout preview="Create your EHL account to get started">
      <Heading>Create Your EHL Account</Heading>

      <Text>
        Hey {name}, your application to the European Hackathon League has been
        accepted. You tried to reset your password, but you do not have an account
        yet, so there is nothing to reset.
      </Text>

      <Text>
        Create your account using the email address this message was sent to
        ({email}):
      </Text>

      <Button href={registerUrl}>Create Your Account</Button>

      <Text muted>
        After creating it you can sign in anytime at ehl.gg.
      </Text>

      <Divider />

      <Text muted>
        If the button above does not work, copy and paste this URL into your browser:
      </Text>
      <p style={{
        fontSize: 12,
        color: "#9B59B6",
        wordBreak: "break-all" as const,
        margin: 0,
        lineHeight: "20px",
      }}>
        {registerUrl}
      </p>
    </EmailLayout>
  );
}
