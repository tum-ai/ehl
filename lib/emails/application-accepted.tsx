import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";

interface ApplicationAcceptedEmailProps {
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  chapterSlug: string;
}

export function ApplicationAcceptedEmail({
  firstName,
  chapterName,
  chapterCity,
  chapterDate,
  chapterSlug,
}: ApplicationAcceptedEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`You're in! Accepted for ${chapterName}`}>
      <Heading>You're In!</Heading>

      <Text>
        Hey {firstName}, congratulations! You have been accepted to compete in the{" "}
        <strong style={{ color: "#E8B84B" }}>{chapterName}</strong>.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
        </tbody>
      </table>

      <Text>
        Show the QR code below at check-in to confirm your attendance:
      </Text>

      {/* QR Code (embedded as CID attachment) */}
      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", margin: "24px 0" }}>
        <tr>
          <td align="center">
            <table cellPadding={0} cellSpacing={0} role="presentation">
              <tr>
                <td style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: 12,
                  padding: 16,
                }}>
                  <img
                    src="cid:qr-code"
                    alt="Check-in QR Code"
                    width={200}
                    height={200}
                    style={{ width: 200, height: 200, display: "block" }}
                  />
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <Button href={`${baseUrl}/matches/${chapterSlug}`}>
        View Match Details
      </Button>

      <Divider />

      <Text muted>
        Save this email for check-in. If you can no longer attend, please let us know
        so we can offer your spot to someone else.
      </Text>
    </EmailLayout>
  );
}
