import { describe, it, expect } from "vitest";
import {
  computeNoShows,
  buildCheckinEnabledChapters,
} from "@/lib/screening-flags";

// ─── buildCheckinEnabledChapters ──────────────────────────

describe("buildCheckinEnabledChapters", () => {
  it("includes a chapter when any application has a real checked_in_at", () => {
    const enabled = buildCheckinEnabledChapters([
      { chapterId: "c1", checkedInAt: "2026-01-01T10:00:00Z" },
      { chapterId: "c1", checkedInAt: null },
    ]);
    expect(enabled.has("c1")).toBe(true);
  });

  it("excludes a chapter where no application was ever checked in (pre-check-in)", () => {
    const enabled = buildCheckinEnabledChapters([
      { chapterId: "legacy", checkedInAt: null },
      { chapterId: "legacy", checkedInAt: null },
    ]);
    expect(enabled.has("legacy")).toBe(false);
    expect(enabled.size).toBe(0);
  });

  it("handles mixed chapters independently", () => {
    const enabled = buildCheckinEnabledChapters([
      { chapterId: "legacy", checkedInAt: null },
      { chapterId: "live", checkedInAt: "2026-06-01T09:00:00Z" },
    ]);
    expect(enabled.has("legacy")).toBe(false);
    expect(enabled.has("live")).toBe(true);
  });
});

// ─── computeNoShows ───────────────────────────────────────

describe("computeNoShows", () => {
  it("does NOT flag a no-show for a pre-check-in chapter (the bug)", () => {
    // First hackathon: status is checked_in (migrated/assumed) but check-in
    // never ran there, so the chapter is absent from checkinEnabledChapters.
    const noShows = computeNoShows({
      otherApps: [{ status: "checked_in", chapterId: "first-hackathon" }],
      teamId: "team-1",
      teamChapterSubmissions: new Set(), // no submission recorded
      checkinEnabledChapters: new Set(), // check-in was NOT available there
    });
    expect(noShows).toBe(0);
  });

  it("DOES flag a genuine no-show in a check-in-enabled chapter", () => {
    const noShows = computeNoShows({
      otherApps: [{ status: "checked_in", chapterId: "live-event" }],
      teamId: "team-1",
      teamChapterSubmissions: new Set(), // checked in but no submission
      checkinEnabledChapters: new Set(["live-event"]),
    });
    expect(noShows).toBe(1);
  });

  it("never flags a participant whose team DID submit", () => {
    const noShows = computeNoShows({
      otherApps: [{ status: "checked_in", chapterId: "live-event" }],
      teamId: "team-1",
      teamChapterSubmissions: new Set(["team-1:live-event"]),
      checkinEnabledChapters: new Set(["live-event"]),
    });
    expect(noShows).toBe(0);
  });

  it("never flags someone who was not checked in", () => {
    const noShows = computeNoShows({
      otherApps: [{ status: "accepted", chapterId: "live-event" }],
      teamId: "team-1",
      teamChapterSubmissions: new Set(),
      checkinEnabledChapters: new Set(["live-event"]),
    });
    expect(noShows).toBe(0);
  });

  it("returns 0 when the applicant is not on a league team", () => {
    const noShows = computeNoShows({
      otherApps: [{ status: "checked_in", chapterId: "live-event" }],
      teamId: null,
      teamChapterSubmissions: new Set(),
      checkinEnabledChapters: new Set(["live-event"]),
    });
    expect(noShows).toBe(0);
  });

  it("counts only the genuine no-shows across mixed past events", () => {
    const noShows = computeNoShows({
      otherApps: [
        // legacy first hackathon: must be suppressed
        { status: "checked_in", chapterId: "first-hackathon" },
        // genuine no-show: checked in, check-in enabled, no submission
        { status: "checked_in", chapterId: "event-b" },
        // attended and submitted: not a no-show
        { status: "checked_in", chapterId: "event-c" },
      ],
      teamId: "team-1",
      teamChapterSubmissions: new Set(["team-1:event-c"]),
      checkinEnabledChapters: new Set(["event-b", "event-c"]),
    });
    expect(noShows).toBe(1);
  });
});
