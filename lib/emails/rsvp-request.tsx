import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";

interface RsvpRequestEmailProps {
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  rsvpToken: string;
}

/**
 * Standalone RSVP request, sent separately from the acceptance email.
 *
 * Deliberately ONE button rather than a "yes" link and a "no" link. Mail
 * scanners (Outlook Safe Links and friends) fetch every URL in a message before
 * the recipient ever sees it, so a link that carried the answer in its URL would
 * be answered by a robot. Here both answers live behind the same read-only page
 * and are recorded by a POST on the page itself, which no scanner performs.
 */
export function RsvpRequestEmail({
  firstName,
  chapterName,
  chapterCity,
  chapterDate,
  rsvpToken,
}: RsvpRequestEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`Are you coming? Confirm your spot at ${chapterName}`}>
      <Heading>Are You Coming?</Heading>

      <Text>
        Hey {firstName}, you have a confirmed spot at the{" "}
        <strong style={{ color: "#E8B84B" }}>{chapterName}</strong>. We are
        finalising numbers for the venue and catering, so please let us know
        whether you will be there.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
        </tbody>
      </table>

      <Text>
        It takes one click: the page below has a button for yes and a button for
        no. Your answer is final once you send it, so pick the one that is true
        today.
      </Text>

      <Button href={`${baseUrl}/rsvp/${rsvpToken}`}>
        Confirm Or Decline
      </Button>

      <Divider />

      <Text muted>
        This does not change your spot or your registration, it only tells the
        organisers whether to expect you. If you cannot make it, telling us early
        lets someone on the waitlist take the place.
      </Text>
    </EmailLayout>
  );
}
