import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";

interface CertificateEmailProps {
  /** Recipient's profile name; null when the profile has no name yet. */
  memberName: string | null;
  teamName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  /** Display result, e.g. "1st Place (+8 pts)" for placed teams or
   * "Participant" (no points) otherwise. */
  resultLabel: string;
  /** Personal certificate link; null when the member has no profile name to
   * print (the personal variant needs one). */
  personalCertificateUrl: string | null;
  teamCertificateUrl: string;
  /** Neutral team participation certificate; only offered to placed teams
   * (unplaced teams' team certificate already is the participation one). */
  participationCertificateUrl: string | null;
}

export function CertificateEmail({
  memberName,
  teamName,
  chapterName,
  chapterCity,
  chapterDate,
  resultLabel,
  personalCertificateUrl,
  teamCertificateUrl,
  participationCertificateUrl,
}: CertificateEmailProps) {
  return (
    <EmailLayout preview={`Your certificates for ${chapterName} are ready`}>
      <Heading>Certificates Ready</Heading>

      <Text>
        Congratulations{memberName ? `, ${memberName}` : ""}! The certificates for
        team <strong style={{ color: "#E8B84B" }}>{teamName}</strong> at the{" "}
        <strong style={{ color: "#E8B84B" }}>{chapterName}</strong> are ready to
        download.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
          <InfoRow label="Result" value={resultLabel} />
        </tbody>
      </table>

      {personalCertificateUrl && (
        <Button href={personalCertificateUrl}>
          Download Your Personal Certificate (PDF)
        </Button>
      )}

      <Button href={teamCertificateUrl}>
        Download Team Certificate (PDF)
      </Button>

      {participationCertificateUrl && (
        <>
          <Text muted>
            Your team placed, so you can also download a neutral participation
            certificate that shows no ranking:
          </Text>
          <Button href={participationCertificateUrl}>
            Download Participation Certificate (PDF)
          </Button>
        </>
      )}

      <Divider />

      <Text muted>
        You can also download your certificates anytime from your team dashboard.
      </Text>
    </EmailLayout>
  );
}
