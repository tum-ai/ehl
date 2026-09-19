import * as React from "react";
import { EmailLayout, Heading, Text, Divider, InfoRow, Button } from "./layout";
import {
  FINALE_CITY,
  FINALE_DATE_LABEL,
  FINALE_RSVP_DEADLINE_LABEL,
  FINALE_SUPPORT_EMAIL,
} from "@/lib/finale";

interface FinaleInviteEmailProps {
  firstName: string;
  teamName: string;
  inviteToken: string;
}

/**
 * Invitation to the Grand Finale for the members of a qualifying team.
 *
 * Copy is supplied verbatim by the organizers and is deliberately FIXED rather
 * than derived: the dates, the partner names and the RSVP deadline are facts
 * about this one event, and a wrong date here is worse than a duplicated
 * string. Only the name, the team and the personal link vary.
 *
 * Deliberately ONE button, for the same reason as the RSVP email: mail scanners
 * fetch every URL in a message before the recipient sees it, so an answer
 * carried in the URL would be given by a robot. Both answers live behind the
 * same read-only page and are recorded by a POST from that page.
 */
export function FinaleInviteEmail({
  firstName,
  teamName,
  inviteToken,
}: FinaleInviteEmailProps) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg";

  return (
    <EmailLayout preview={`You're in: EHL Grand Finale, ${FINALE_CITY}, ${FINALE_DATE_LABEL}`}>
      <Heading>You&apos;re in 🏆</Heading>

      <Text>Hey {firstName},</Text>

      <Text>
        Congratulations! Your team,{" "}
        <strong style={{ color: "#E8B84B" }}>{teamName}</strong>, has made it
        into the top 15 of the European Hackathon League. We are very excited to
        have you as finalists in this first ever iteration of the league, and we
        would like to invite you to the EHL Grand Finale in {FINALE_CITY} on{" "}
        {FINALE_DATE_LABEL}.
      </Text>

      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: "100%", marginBottom: 16 }}>
        <tbody>
          <InfoRow label="Event" value="EHL Grand Finale" />
          <InfoRow label="Location" value={FINALE_CITY} />
          <InfoRow label="Date" value={FINALE_DATE_LABEL} />
          <InfoRow label="RSVP by" value={FINALE_RSVP_DEADLINE_LABEL} />
        </tbody>
      </table>

      <Text>
        Out of all the teams that competed in the league this season, yours is
        one of the final line-up. That&apos;s a big deal, so congratulations,
        you&apos;ve earned it.
      </Text>

      <Text>Here&apos;s what that means for you:</Text>

      <Text>
        <strong style={{ color: "#E8B84B" }}>
          You&apos;re a finalist, not just a participant.
        </strong>{" "}
        There will be other teams at the Grand Finale too, regular participants
        who will be competing in the challenges as usual. Everyone hacks in the
        same three challenge tracks, presented by our partners BMW, Atira and
        Tacto, on the same two days. However, only finalists like your team can
        qualify for the final pitch in front of the grand jury, and only
        finalists are eligible for the title of EHL Overall Winner. Bragging
        rights and LinkedIn gold included ;D
      </Text>

      <Text>
        <strong style={{ color: "#E8B84B" }}>How advancement works this time:</strong>{" "}
        each challenge track is judged in the same way as always, but only
        finalists can advance to the final pitch round on the big stage. So,
        even if a team of regular participants wins their track outright,
        it&apos;s the two highest-placed finalist teams from each track who move
        on, that&apos;s six teams in total who will pitch live in front of the
        grand jury to decide the EHL Overall Winner.
      </Text>

      <Text>
        <strong style={{ color: "#E8B84B" }}>
          What&apos;s in it for you as a finalist?
        </strong>
      </Text>

      <ul style={{ margin: "0 0 16px", paddingLeft: 20, color: "#C8C8D8", fontSize: 15, lineHeight: "24px" }}>
        <li style={{ marginBottom: 6 }}>Exclusive EHL Finalist merchandise</li>
        <li style={{ marginBottom: 6 }}>
          Eligibility for the EHL Grand Prize, which has a significantly larger
          prize than previous events (we&apos;ll share the exact amount closer to
          the event)
        </li>
        <li>
          Everything you always get at our hackathons: food, drinks, networking,
          and challenge prizes
        </li>
      </ul>

      <Text>
        <strong style={{ color: "#E8B84B" }}>What we need from you:</strong>{" "}
        Please RSVP by {FINALE_RSVP_DEADLINE_LABEL} to confirm your place. To
        compete, your team needs to consist of three to five members, each of
        whom must RSVP in time.
      </Text>

      <Button href={`${baseUrl}/finale/${inviteToken}`}>RSVP here</Button>

      <Text muted>
        This link is personal to you. Every member of your team gets their own,
        and each of you has to answer. One click confirms your spot and sends
        your check-in QR code.
      </Text>

      <Divider />

      <Text>
        For any questions you may still have, feel free to email us at{" "}
        {FINALE_SUPPORT_EMAIL} and we&apos;ll sort it out. See you in{" "}
        {FINALE_CITY}! Can&apos;t wait to see what you build.
      </Text>

      <Text>
        The TUM.ai Makeathon Team
      </Text>
    </EmailLayout>
  );
}
