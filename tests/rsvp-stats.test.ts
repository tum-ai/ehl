import { describe, it, expect } from "vitest";
import { countRsvps, type RsvpCountable } from "@/lib/rsvp-stats";

// The counters shown on the admin applications page. The one worth pinning is
// `notAsked`, which must equal exactly the set sendRsvpEmails() will mail.
//
// REGRESSION: the first version counted checked-in applicants as "not asked".
// sendRsvpEmails() only selects status "accepted", so on a real chapter (6
// checked-in, 0 un-asked accepted) the card read "Not asked: 6", pressing the
// button sent 0, and the number never moved.

const app = (status: string, rsvp?: RsvpCountable["rsvp"]): RsvpCountable => ({ status, rsvp });

describe("countRsvps", () => {
  it("counts an empty list as all zeroes", () => {
    expect(countRsvps([])).toEqual({ confirmed: 0, declined: 0, awaiting: 0, notAsked: 0 });
  });

  it("counts yes, no and asked-but-unanswered separately", () => {
    expect(
      countRsvps([
        app("accepted", { response: "yes" }),
        app("accepted", { response: "no" }),
        app("accepted", { response: null }),
      ])
    ).toEqual({ confirmed: 1, declined: 1, awaiting: 1, notAsked: 0 });
  });

  it("counts an accepted applicant with no RSVP row as not asked", () => {
    expect(countRsvps([app("accepted")]).notAsked).toBe(1);
  });

  it("does NOT count checked-in applicants as not asked (they are never mailed)", () => {
    const counts = countRsvps([
      app("checked_in"),
      app("checked_in"),
      app("checked_in"),
      app("checked_in"),
      app("checked_in"),
      app("checked_in"),
    ]);
    expect(counts.notAsked).toBe(0);
  });

  it("ignores every non-accepted status for not asked", () => {
    const counts = countRsvps([
      app("pending"),
      app("rejected"),
      app("waitlisted"),
      app("cancelled"),
      app("checked_in"),
      app("accepted"),
    ]);
    expect(counts.notAsked).toBe(1);
  });

  it("still counts an answer from someone who has since checked in", () => {
    // Answering is not status-scoped: they RSVP'd yes, then showed up.
    const counts = countRsvps([app("checked_in", { response: "yes" })]);
    expect(counts).toEqual({ confirmed: 1, declined: 0, awaiting: 0, notAsked: 0 });
  });

  it("treats a null rsvp the same as a missing one", () => {
    expect(countRsvps([app("accepted", null)]).notAsked).toBe(1);
  });

  it("excludes a CANCELLED applicant who never answered from Awaiting", () => {
    // Production case: someone was accepted, mailed, then cancelled 13 minutes
    // later ("emailed he cannot attend"). He never answered the RSVP, so he sat
    // in Awaiting for ever, inflating the number used to decide who to chase.
    const counts = countRsvps([
      app("accepted", { response: "yes" }),
      app("cancelled", { response: null }),
    ]);
    expect(counts).toEqual({ confirmed: 1, declined: 0, awaiting: 0, notAsked: 0 });
  });

  it("excludes a CANCELLED applicant who had answered yes from Confirmed", () => {
    // Counting them would overstate the headcount, which is the one number the
    // whole feature exists to get right.
    const counts = countRsvps([app("cancelled", { response: "yes" })]);
    expect(counts.confirmed).toBe(0);
  });

  it("excludes a CANCELLED applicant who had answered no from Declined", () => {
    expect(countRsvps([app("cancelled", { response: "no" })]).declined).toBe(0);
  });

  it("never counts a cancelled applicant as not asked, even with no RSVP row", () => {
    expect(countRsvps([app("cancelled")]).notAsked).toBe(0);
  });

  it("reproduces the live Zurich board: 83 asked, one cancelled", () => {
    const rows: RsvpCountable[] = [
      ...Array.from({ length: 33 }, () => app("accepted", { response: "yes" })),
      ...Array.from({ length: 49 }, () => app("accepted", { response: null })),
      app("cancelled", { response: null }),
    ];
    // The board showed Awaiting 50; the cancelled applicant was the 50th.
    expect(countRsvps(rows)).toEqual({
      confirmed: 33,
      declined: 0,
      awaiting: 49,
      notAsked: 0,
    });
  });

  it("matches the real chapter that exposed the bug", () => {
    // 2 accepted (both asked: one answered yes, one awaiting) + 6 checked in.
    const counts = countRsvps([
      app("accepted", { response: "yes" }),
      app("accepted", { response: null }),
      ...Array.from({ length: 6 }, () => app("checked_in")),
      app("pending"),
      app("pending"),
      app("pending"),
      app("rejected"),
      app("waitlisted"),
    ]);
    expect(counts).toEqual({ confirmed: 1, declined: 0, awaiting: 1, notAsked: 0 });
  });
});
