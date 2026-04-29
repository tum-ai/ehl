import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow } from "./layout";

interface ApplicationReceivedEmailProps {
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
}

export function ApplicationReceivedEmail({
  firstName,
  chapterName,
  chapterCity,
  chapterDate,
}: ApplicationReceivedEmailProps) {
  return (
    <EmailLayout preview={`Application received for ${chapterName}`}>
      <Heading>Application Received</Heading>

      <Text>
        Hey {firstName}, thanks for applying to the{" "}
        <strong style={{ color: "#E8B84B" }}>European Hackathon League</strong>!
      </Text>

      <Text>
        We have received your application for the following match:
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
        </tbody>
      </table>

      <Text>
        Our team will review your application and get back to you soon.
        You will receive an email once a decision has been made.
      </Text>

      <Divider />

      <Text muted>
        If you did not submit this application, please ignore this email.
      </Text>
    </EmailLayout>
  );
}
