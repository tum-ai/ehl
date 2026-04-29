import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";

interface ApplicationRejectedEmailProps {
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
}

export function ApplicationRejectedEmail({
  firstName,
  chapterName,
  chapterCity,
  chapterDate,
}: ApplicationRejectedEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`Application update: ${chapterName}`}>
      <Heading>Application Update</Heading>

      <Text>
        Hey {firstName}, thank you for your interest in the{" "}
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
        Unfortunately, we were unable to offer you a spot for this match due to the high number of applications.
        We appreciate the time you took to apply and encourage you to apply again for upcoming matches in the season.
      </Text>

      <Button href={`${baseUrl}/matches`}>
        View Upcoming Matches
      </Button>

      <Divider />

      <Text muted>
        The European Hackathon League hosts multiple matches throughout the season.
        Keep an eye on our website for the next opportunity to compete.
      </Text>
    </EmailLayout>
  );
}
