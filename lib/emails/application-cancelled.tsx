import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";

interface ApplicationCancelledEmailProps {
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
}

export function ApplicationCancelledEmail({
  firstName,
  chapterName,
  chapterCity,
  chapterDate,
}: ApplicationCancelledEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`Your spot for ${chapterName} has been cancelled`}>
      <Heading>Spot Cancelled</Heading>

      <Text>
        Hey {firstName}, this confirms that your spot for the{" "}
        <strong style={{ color: "#E8B84B" }}>{chapterName}</strong> has been cancelled.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
        </tbody>
      </table>

      <Text>
        We are sorry you will not be joining us this time. If you believe this was a
        mistake, please reply to this email and we will look into it.
      </Text>

      <Button href={`${baseUrl}/matches`}>
        View Upcoming Matches
      </Button>

      <Divider />

      <Text muted>
        The European Hackathon League hosts multiple matches throughout the season.
        We hope to see you at a future match.
      </Text>
    </EmailLayout>
  );
}
