import * as React from "react";
import { EmailLayout, Heading, Text, Divider } from "./layout";

interface VerificationCodeEmailProps {
  name: string;
  code: string;
  type: "registration" | "solo_registration" | "member_confirm";
  teamName?: string;
  presidentName?: string;
}

export function VerificationCodeEmail({ name, code, type, teamName, presidentName }: VerificationCodeEmailProps) {
  const isRegistration = type === "registration" || type === "solo_registration";
  const preview = isRegistration
    ? `Your EHL verification code: ${code}`
    : `Confirm your spot on Team ${teamName}: ${code}`;

  return (
    <EmailLayout preview={preview}>
      <Heading>
        {isRegistration ? "Verify Your Email" : "Confirm Your Spot"}
      </Heading>

      {type === "solo_registration" ? (
        <Text>
          Hey {name}, enter this code to complete your registration
          for the European Hackathon League.
        </Text>
      ) : type === "registration" ? (
        <Text>
          Hey {name}, enter this code to complete your team registration
          for the European Hackathon League.
        </Text>
      ) : (
        <Text>
          Hey {name}, {presidentName} added you to <strong style={{ color: "#E8B84B" }}>{teamName}</strong> in
          the European Hackathon League. Enter this code to confirm your spot on the roster.
        </Text>
      )}

      {/* Code display */}
      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ margin: "24px auto", textAlign: "center" as const }}>
        <tr>
          <td style={{
            backgroundColor: "rgba(232, 180, 75, 0.08)",
            border: "2px solid rgba(232, 180, 75, 0.25)",
            borderRadius: 12,
            padding: "20px 40px",
          }}>
            <span style={{
              fontSize: 36,
              fontWeight: 900,
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              color: "#E8B84B",
              letterSpacing: "0.3em",
            }}>
              {code}
            </span>
          </td>
        </tr>
      </table>

      <Text muted>
        This code expires in 15 minutes. If you did not request this, you can safely ignore this email.
      </Text>

      <Divider />

      <Text muted>
        Do not share this code with anyone.
      </Text>
    </EmailLayout>
  );
}
