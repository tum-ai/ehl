/**
 * Fixed facts about the Grand Finale invite round.
 *
 * These are deliberately constants rather than values read from the chapter
 * row. The invite email, the invite page and the admin board must all state the
 * SAME date and deadline, and the copy was signed off by the organizers with
 * these exact words. The chapter row still drives everything else (the
 * acceptance email, check-in), so if the event moves, change the chapter row AND
 * this file together.
 */

/** Teams ranked this or better on the season leaderboard are invited. Ties included. */
export const FINALE_INVITE_MAX_RANK = 15;

export const FINALE_CITY = "Munich";
export const FINALE_DATE_LABEL = "10-11 October";
export const FINALE_RSVP_DEADLINE_LABEL = "30 September";
export const FINALE_SUPPORT_EMAIL = "makeathon@tum-ai.com";

export const FINALE_INVITE_SUBJECT = `You're in 🏆 EHL Grand Finale, ${FINALE_CITY} - Oct 10-11`;
