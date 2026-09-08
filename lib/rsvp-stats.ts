/**
 * RSVP counters for the admin applications page.
 *
 * Pure and shared so the numbers on the screen cannot drift from what the
 * "Send RSVP Request" button actually does. The subtle one is `notAsked`: it
 * counts ONLY status "accepted", exactly the set sendRsvpEmails() mails.
 * Including checked-in applicants there would display work the button can never
 * clear (they have already arrived, so they are never sent a request), leaving a
 * number that never moves no matter how often an admin presses it.
 *
 * CANCELLED applicants are excluded from every count. They are not coming, and
 * that was settled outside the RSVP flow, so counting them distorts exactly the
 * numbers this board exists to give: a cancelled person who never answered sits
 * in "Awaiting" for ever (they never will), and one who had answered "yes"
 * inflates the headcount. Their row is deliberately kept in the database, so the
 * record that they were asked survives and a later send cannot re-mail them.
 */

export interface RsvpCountable {
  status: string;
  rsvp?: { response: "yes" | "no" | null } | null;
}

export interface RsvpCounts {
  /** Answered yes. Counts a checked-in person's earlier yes, never a cancelled one. */
  confirmed: number;
  /** Answered no. Same scoping as `confirmed`. */
  declined: number;
  /** Asked (a row exists), still unanswered, and still actually coming. */
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
    // Cancelled applicants are out of the picture entirely, answered or not.
    if (app.status === "cancelled") continue;

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
