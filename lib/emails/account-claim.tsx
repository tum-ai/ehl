import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface AccountClaimEmailProps {
  name: string;
  email: string;
  forgotPasswordUrl: string;
}

/**
 * Sent once to participants whose accounts were imported from a previous
 * match (created without a password). Directs them to the standard
 * "forgot password" flow so they can claim their account. Unlike the
 * password-reset email this contains no token, so it never expires.
 */
export function AccountClaimEmail({ name, email, forgotPasswordUrl }: AccountClaimEmailProps) {
  return (
    <EmailLayout preview="Set your password to access your EHL account">
      <Heading>Your EHL Account Is Ready</Heading>

      <Text>
        Hey {name}, you competed in a European Hackathon League match, so we
        created an account for you on the new EHL platform. Your results and
        team are already linked to it.
      </Text>

      <Text>
        To access it, set a password using the email address this message was
        sent to ({email}):
      </Text>

      <Button href={forgotPasswordUrl}>
        Set Your Password
      </Button>

      <Text muted>
        You will receive a confirmation link by email. After setting your
        password you can sign in anytime at ehl.gg.
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
        {forgotPasswordUrl}
      </p>
    </EmailLayout>
  );
}
