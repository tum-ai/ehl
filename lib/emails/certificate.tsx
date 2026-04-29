import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";

interface CertificateEmailProps {
  teamName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  placementLabel: string;
  points: number;
  certificateUrl: string;
}

export function CertificateEmail({
  teamName,
  chapterName,
  chapterCity,
  chapterDate,
  placementLabel,
  points,
  certificateUrl,
}: CertificateEmailProps) {
  return (
    <EmailLayout preview={`Your certificate for ${chapterName} is ready`}>
      <Heading>Certificate Ready</Heading>

      <Text>
        Congratulations, <strong style={{ color: "#E8B84B" }}>{teamName}</strong>!
        Your certificate for the{" "}
        <strong style={{ color: "#E8B84B" }}>{chapterName}</strong> is ready to download.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
          <InfoRow label="Result" value={`${placementLabel} (+${points} pts)`} />
        </tbody>
      </table>

      <Button href={certificateUrl}>
        Download Certificate (PDF)
      </Button>

      <Divider />

      <Text muted>
        You can also download your certificate anytime from your team dashboard.
      </Text>
    </EmailLayout>
  );
}
