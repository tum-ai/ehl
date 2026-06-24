import * as React from "react";
import { EmailLayout, Heading, Text, Divider, Button } from "./layout";

interface ChapterBroadcastEmailProps {
  subject: string;
  /** Pre-split paragraphs of the admin's message (see lib/emails/text-block.ts). */
  paragraphs: string[];
  chapterName: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

/**
 * Generic one-off email sent to a chapter's accepted/checked-in/waitlisted
 * applicants. The body is admin-authored plain text rendered as escaped React
 * text children, never HTML. An optional CTA links back to the event hub.
 */
export function ChapterBroadcastEmail({
  subject,
  paragraphs,
  chapterName,
  ctaUrl,
  ctaLabel,
}: ChapterBroadcastEmailProps) {
  return (
    <EmailLayout preview={subject}>
      <Heading>{subject}</Heading>

      {paragraphs.map((p, i) => (
        <Text key={i} preserveLines>
          {p}
        </Text>
      ))}

      {ctaUrl && (
        <Button href={ctaUrl}>{ctaLabel || "Open Match Hub"}</Button>
      )}

      <Divider />

      <Text muted>
        You received this because you applied to {chapterName} in the European
        Hackathon League.
      </Text>
    </EmailLayout>
  );
}
