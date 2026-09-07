/**
 * RSVP counters for the admin applications page.
 *
 * Pure and shared so the numbers on the screen cannot drift from what the
 * "Send RSVP Request" button actually does. The subtle one is `notAsked`: it
 * counts ONLY status "accepted", exactly the set sendRsvpEmails() mails.
 * Including checked-in applicants there would display work the button can never
 * clear (they have already arrived, so they are never sent a request), leaving a
 * number that never moves no matter how often an admin presses it.
 */

export interface RsvpCountable {
  status: string;
  rsvp?: { response: "yes" | "no" | null } | null;
}

export interface RsvpCounts {
  /** Answered yes. Not status-scoped: a checked-in person's earlier yes counts. */
  confirmed: number;
  /** Answered no. Not status-scoped, for the same reason. */
  declined: number;
  /** Asked (a row exists) but has not answered. */
  awaiting: number;
  /** Accepted and never asked. Equals what the next send will target. */
  notAsked: number;
}

export function countRsvps(applications: RsvpCountable[]): RsvpCounts {
  let confirmed = 0;
  let declined = 0;
  let awaiting = 0;
  let notAsked = 0;

  for (const app of applications) {
    if (app.rsvp) {
      if (app.rsvp.response === "yes") confirmed++;
      else if (app.rsvp.response === "no") declined++;
      else awaiting++;
    } else if (app.status === "accepted") {
      notAsked++;
    }
  }

  return { confirmed, declined, awaiting, notAsked };
}
