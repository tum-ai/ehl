import { describe, it, expect } from "vitest";
import {
  RSVP_WINDOW_HOURS,
  rsvpDeadline,
  isRsvpExpired,
  rsvpCutoffIso,
  formatRsvpDeadline,
} from "@/lib/rsvp-window";

// The RSVP window is derived from application_rsvps.email_sent_at rather than
// stored, so the email, the page and the server action all compute the same
// deadline from the same row. These pin the arithmetic and the boundary.

const HOUR = 60 * 60 * 1000;
const SENT = new Date("2026-09-07T12:00:00.000Z");

describe("the RSVP response window", () => {
  it("defaults to 48 hours", () => {
    expect(RSVP_WINDOW_HOURS).toBe(48);
  });

  it("puts the deadline exactly 48 hours after the request was emailed", () => {
    expect(rsvpDeadline(SENT).toISOString()).toBe("2026-09-09T12:00:00.000Z");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(rsvpDeadline(SENT.toISOString()).getTime()).toBe(rsvpDeadline(SENT).getTime());
  });

  it("is open one millisecond before the deadline", () => {
    const justBefore = new Date(SENT.getTime() + 48 * HOUR - 1);
    expect(isRsvpExpired(SENT, justBefore)).toBe(false);
  });

  it("is closed AT the deadline (the boundary is not a grace period)", () => {
    const exactly = new Date(SENT.getTime() + 48 * HOUR);
    expect(isRsvpExpired(SENT, exactly)).toBe(true);
  });

  it("is closed well after the deadline", () => {
    expect(isRsvpExpired(SENT, new Date(SENT.getTime() + 100 * HOUR))).toBe(true);
  });

  it("treats a missing or unparseable timestamp as still open, never as expired", () => {
    // Failing open matters: wrongly reporting "expired" would tell a real
    // applicant their spot is gone.
    expect(isRsvpExpired(null)).toBe(false);
    expect(isRsvpExpired("not a date")).toBe(false);
  });

  it("produces a SQL cutoff that excludes rows older than the window", () => {
    const now = new Date(SENT.getTime() + 49 * HOUR);
    const cutoff = new Date(rsvpCutoffIso(now));
    // A request emailed at SENT is now outside the window, so it sorts before
    // the cutoff and the `.gt()` filter will not match it.
    expect(SENT.getTime()).toBeLessThan(cutoff.getTime());
  });

  it("produces a cutoff that still includes a fresh row", () => {
    const now = new Date(SENT.getTime() + 1 * HOUR);
    expect(SENT.getTime()).toBeGreaterThan(new Date(rsvpCutoffIso(now)).getTime());
  });

  it("formats the deadline with a weekday, date and CET time", () => {
    const out = formatRsvpDeadline(SENT);
    expect(out).toMatch(/Wednesday/);
    expect(out).toMatch(/9 September/);
    expect(out).toMatch(/CET$/);
  });
});
