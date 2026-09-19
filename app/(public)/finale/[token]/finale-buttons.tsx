"use client";

import { useState } from "react";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { respondToFinaleInvite, type FinaleResponse } from "@/lib/actions/finale-invites";
import {
  FINALE_CITY,
  FINALE_DATE_LABEL,
  FINALE_RSVP_DEADLINE_LABEL,
  FINALE_SUPPORT_EMAIL,
} from "@/lib/finale";

/**
 * The two buttons behind a Grand Finale invite.
 *
 * Answering is a state change (it creates an accepted application), so it must
 * happen on a deliberate click and never as a side effect of opening the link:
 * mail scanners fetch every URL in an email before the recipient sees it. The
 * page itself is read-only and the answer travels over a POST server action.
 *
 * The consent line above the buttons is load-bearing: clicking "I'm in" writes
 * consent_attendance and consent_privacy on the application it creates, so the
 * person must be told that before they click.
 */
export function FinaleInviteButtons({
  token,
  firstName,
  teamName,
  initialResponse,
  initialAccepted,
}: {
  token: string;
  firstName: string;
  teamName: string;
  initialResponse: FinaleResponse | null;
  initialAccepted: boolean;
}) {
  const [response, setResponse] = useState<FinaleResponse | null>(initialResponse);
  const [accepted, setAccepted] = useState(initialAccepted);
  const [pending, setPending] = useState<FinaleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnswer(answer: FinaleResponse) {
    setError(null);
    setPending(answer);
    const result = await respondToFinaleInvite(token, answer);
    if ("error" in result) {
      setError(result.error);
      setPending(null);
      return;
    }
    // On a lost race the server's standing answer wins, not the click.
    setResponse(result.response);
    setAccepted(result.accepted);
    setPending(null);
  }

  return (
    <Section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-md text-center">
        <h1 className="text-2xl font-black">
          {response === "yes"
            ? "You are in 🏆"
            : response === "no"
              ? "Thanks for telling us"
              : "EHL Grand Finale"}
        </h1>

        <p className="mt-3 text-text-secondary">
          Hey {firstName}, your team{" "}
          <strong className="text-gold">{teamName}</strong> is one of the
          finalists of the European Hackathon League.
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {FINALE_CITY}, {FINALE_DATE_LABEL}
        </p>

        {response === "yes" ? (
          <div className="mt-6 rounded-lg border border-gold/30 bg-gold/5 p-5">
            <p className="text-lg font-bold text-gold">Your spot is confirmed.</p>
            <p className="mt-2 text-sm text-text-secondary">
              {accepted
                ? `Your check-in QR code is on its way by email. Bring it to ${FINALE_CITY}, it gets you in.`
                : `We have your answer, but we could not finish your registration automatically. Please email ${FINALE_SUPPORT_EMAIL} so we can sort it out.`}
            </p>
            <p className="mt-3 text-xs text-text-secondary">
              Every member of your team has to confirm separately, and a team
              needs three to five confirmed members to compete.
            </p>
          </div>
        ) : response === "no" ? (
          <div className="mt-6 rounded-lg border border-white/10 bg-surface-card/60 p-5">
            <p className="text-lg font-bold">You told us you cannot make it.</p>
            <p className="mt-2 text-sm text-text-secondary">
              Thanks for letting us know in time. If that changes, email{" "}
              {FINALE_SUPPORT_EMAIL} and the organisers will sort it out.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-5 text-sm text-text-secondary">
              Only finalists can reach the final pitch in front of the grand jury
              and compete for the title of EHL Overall Winner. Please answer by{" "}
              <strong className="text-gold">{FINALE_RSVP_DEADLINE_LABEL}</strong>.
              Your answer is final once you send it.
            </p>

            <p className="mt-3 text-xs text-text-secondary">
              By choosing &quot;I&apos;m in&quot; you register for the Grand
              Finale, confirm that you will attend, and accept our privacy
              policy. You will get your check-in QR code by email straight away.
            </p>

            {error && (
              <div className="mt-5 rounded-lg border border-error/20 bg-error/5 p-3">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button onClick={() => handleAnswer("yes")} disabled={pending !== null}>
                {pending === "yes" ? "Saving..." : "I'm in"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleAnswer("no")}
                disabled={pending !== null}
              >
                {pending === "no" ? "Saving..." : "I'm out"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
