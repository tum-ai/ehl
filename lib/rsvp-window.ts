/**
 * The RSVP response window.
 *
 * An applicant has a fixed number of hours from the moment the request was
 * emailed to answer. After that the link stops accepting answers, so organisers
 * can reallocate the spot to the waitlist without wondering whether a late yes
 * is still coming.
 *
 * The deadline is DERIVED from application_rsvps.email_sent_at rather than
 * stored, so there is one source of truth and no way for a stored copy to drift
 * from the row that produced it. One consequence worth knowing: changing
 * RSVP_WINDOW_HOURS moves the deadline for links already in flight.
 *
 * Shared by the email (which prints the deadline), the page (which stops
 * offering the buttons) and the server action (which refuses the write), so the
 * three can never disagree about whether the window is open.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const RSVP_WINDOW_HOURS = envInt("RSVP_WINDOW_HOURS", 48);

const MS_PER_HOUR = 60 * 60 * 1000;

/** When the window closes for a request emailed at `emailSentAt`. */
export function rsvpDeadline(emailSentAt: string | Date): Date {
  const sent = emailSentAt instanceof Date ? emailSentAt : new Date(emailSentAt);
  return new Date(sent.getTime() + RSVP_WINDOW_HOURS * MS_PER_HOUR);
}

/** True once the window has closed. An invalid timestamp is treated as open. */
export function isRsvpExpired(emailSentAt: string | Date | null, now: Date = new Date()): boolean {
  if (!emailSentAt) return false;
  const deadline = rsvpDeadline(emailSentAt);
  if (Number.isNaN(deadline.getTime())) return false;
  return deadline.getTime() <= now.getTime();
}

/**
 * The earliest email_sent_at that is still inside the window. Used as a SQL
 * filter so expiry is enforced by the same statement that records the answer,
 * rather than in a read-then-write gap.
 */
export function rsvpCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - RSVP_WINDOW_HOURS * MS_PER_HOUR).toISOString();
}

/** "Tuesday, 9 September at 18:30 CET" for the email and the page. */
export function formatRsvpDeadline(emailSentAt: string | Date): string {
  const d = rsvpDeadline(emailSentAt);
  const date = d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Berlin",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  return `${date} at ${time} CET`;
}
