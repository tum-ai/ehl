import * as React from "react";
import { EmailLayout, Heading, Text, Button, Divider } from "./layout";

interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
}

export function PasswordResetEmail({ name, resetUrl }: PasswordResetEmailProps) {
  return (
    <EmailLayout preview="Reset your EHL password">
      <Heading>Reset Your Password</Heading>

      <Text>
        Hey {name}, we received a request to reset the password for your
        European Hackathon League account.
      </Text>

      <Button href={resetUrl}>
        Reset Password
      </Button>

      <Text muted>
        This link expires in 1 hour. If you did not request a password reset,
        you can safely ignore this email.
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
        {resetUrl}
      </p>
    </EmailLayout>
  );
}
