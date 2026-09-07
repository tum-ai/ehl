"use client";

import { useState } from "react";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { submitRsvp, type RsvpResponse } from "@/lib/actions/rsvp";

/**
 * Explicit confirmation step for the post-acceptance RSVP.
 *
 * Recording an answer is a state change, so it must happen on a deliberate
 * click, never as a side effect of opening the link: mail scanners fetch every
 * URL in an email before the recipient sees it. The page itself is read-only
 * and the answer travels over a POST server action from here.
 *
 * The first answer is final, so once a response exists this renders the
 * recorded answer and no buttons at all.
 */
export function RsvpButtons({
  token,
  firstName,
  chapterName,
  chapterCity,
  chapterDate,
  initialResponse,
}: {
  token: string;
  firstName: string;
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  initialResponse: RsvpResponse | null;
}) {
  const [response, setResponse] = useState<RsvpResponse | null>(initialResponse);
  const [pending, setPending] = useState<RsvpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnswer(answer: RsvpResponse) {
    setError(null);
    setPending(answer);
    const result = await submitRsvp(token, answer);
    if ("error" in result) {
      setError(result.error);
      setPending(null);
      return;
    }
    // On a lost race the server's standing answer wins, not the click.
    setResponse(result.response);
    setPending(null);
  }

  return (
    <Section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-md text-center">
        <h1 className="text-2xl font-black">
          {response ? "Thanks, that is noted" : "Are you coming?"}
        </h1>

        <p className="mt-3 text-text-secondary">
          Hey {firstName}, you have a spot at{" "}
          <strong className="text-gold">{chapterName}</strong>.
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {chapterCity}, {chapterDate}
        </p>

        {response ? (
          <div className="mt-6 rounded-lg border border-gold/30 bg-gold/5 p-5">
            <p className="text-lg font-bold text-gold">
              {response === "yes"
                ? "You confirmed your attendance."
                : "You told us you cannot make it."}
            </p>
            <p className="mt-2 text-sm text-text-secondary">
              {response === "yes"
                ? "See you there. Bring the QR code from your acceptance email for check-in."
                : "Thanks for letting us know early, it lets someone on the waitlist take the place."}
            </p>
            <p className="mt-3 text-xs text-text-secondary">
              This answer is final. If it changed, reply to the acceptance email
              and the organisers will sort it out.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-5 text-sm text-text-secondary">
              Let the organisers know whether to expect you. Your answer is final
              once you send it, and it does not change your spot either way.
            </p>

            {error && (
              <div className="mt-5 rounded-lg border border-error/20 bg-error/5 p-3">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button onClick={() => handleAnswer("yes")} disabled={pending !== null}>
                {pending === "yes" ? "Saving..." : "Confirm attendance"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleAnswer("no")}
                disabled={pending !== null}
              >
                {pending === "no" ? "Saving..." : "I cannot make it"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
