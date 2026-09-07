import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";
import { RSVP_WINDOW_HOURS } from "@/lib/rsvp-window";

interface RsvpRequestEmailProps {
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  rsvpToken: string;
  /** Absolute deadline, already formatted (see formatRsvpDeadline). */
  deadline: string;
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
  deadline,
}: RsvpRequestEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`One click left: secure your spot at ${chapterName}`}>
      <Heading>One Click Left</Heading>

      <Text>Hey {firstName},</Text>

      <Text>
        Recently we sent you your acceptance for the{" "}
        <strong style={{ color: "#E8B84B" }}>{chapterName}</strong>. Congrats,
        you made the cut! 🎉 Now there is just one last step to lock in your spot
        for real: your RSVP.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Match" value={chapterName} />
          <InfoRow label="Location" value={chapterCity} />
          <InfoRow label="Date" value={chapterDate} />
          <InfoRow label="Respond by" value={deadline} />
        </tbody>
      </table>

      <Text>
        This event is pretty exclusive, and plenty of talented hackers are on the
        waitlist hoping to take your place. If you do not confirm in time, your
        spot goes to the next person in line, so do not miss your ticket!
      </Text>

      <Button href={`${baseUrl}/rsvp/${rsvpToken}`}>
        Secure My Spot
      </Button>

      <Text muted>
        The link works for {RSVP_WINDOW_HOURS} hours, until {deadline}. It takes
        one click: the page has a button to confirm and a button to decline, and
        your answer is final once you send it.
      </Text>

      <Divider />

      <Text>
        We cannot wait to build, hack and turn {chapterName} upside down with you
        for two days. See you soon! 🚀
      </Text>

      <Text>
        Best,
        <br />
        Your Makeathon Team
      </Text>
    </EmailLayout>
  );
}
