import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getFinaleInviteByToken } from "@/lib/actions/finale-invites";
import { FinaleInviteButtons } from "./finale-buttons";

interface PageProps {
  params: Promise<{ token: string }>;
}

// The invite token is an unguessable bearer link mailed to one person. It must
// never be statically cached: the page resolves the invite fresh on every
// request and 404s on an unknown token.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Grand Finale Invitation",
  // Keep the page (and thus the token in its URL) out of every index and
  // archive, and never leak the token via the Referer header.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// IMPORTANT: this page only READS. Mail scanners fetch every link in an email
// before the recipient opens it, so answering here would accept people who never
// clicked. The answer is written exclusively by the respondToFinaleInvite server
// action, on a deliberate click.
export default async function FinaleInvitePage({ params }: PageProps) {
  const { token } = await params;

  const invite = await getFinaleInviteByToken(token);
  if (!invite) {
    notFound();
  }

  return (
    <FinaleInviteButtons
      token={token}
      firstName={invite.firstName}
      teamName={invite.teamName}
      initialResponse={invite.response}
      initialAccepted={invite.accepted}
    />
  );
}
