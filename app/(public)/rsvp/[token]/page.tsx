import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getRsvpByToken } from "@/lib/actions/rsvp";
import { RsvpButtons } from "./rsvp-buttons";

interface PageProps {
  params: Promise<{ token: string }>;
}

// The RSVP token is an unguessable bearer link mailed to one applicant. It must
// never be statically cached: the page resolves the application fresh on every
// request and 404s on an unknown token.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm Attendance",
  // Keep the page (and thus the token in its URL) out of every index and
  // archive, and never leak the token via the Referer header.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// IMPORTANT: this page only READS. Mail scanners fetch every link in an email
// before the recipient opens it, so recording an answer here would log a
// fabricated response for anyone whose provider prefetches links. The answer is
// written exclusively by the submitRsvp server action, on a deliberate click.
export default async function RsvpPage({ params }: PageProps) {
  const { token } = await params;

  const rsvp = await getRsvpByToken(token);
  if (!rsvp) {
    notFound();
  }

  return (
    <RsvpButtons
      token={token}
      firstName={rsvp.firstName}
      chapterName={rsvp.chapterName}
      chapterCity={rsvp.chapterCity}
      chapterDate={rsvp.chapterDate}
      initialResponse={rsvp.response}
    />
  );
}
