import { describe, it, expect } from "vitest";
import { splitParagraphs } from "@/lib/emails/text-block";
import {
  sanitizeBroadcastStatuses,
  acceptanceEmailSubject,
  BROADCASTABLE_STATUSES,
} from "@/lib/communications";
import { renderChapterBroadcastEmail } from "@/lib/emails/render";

// ─── splitParagraphs ────────────────────────────────────────

describe("splitParagraphs", () => {
  it("returns empty array for empty/whitespace input", () => {
    expect(splitParagraphs("")).toEqual([]);
    expect(splitParagraphs("   \n  \n ")).toEqual([]);
  });

  it("splits on blank lines into trimmed paragraphs", () => {
    expect(splitParagraphs("First para.\n\nSecond para.")).toEqual([
      "First para.",
      "Second para.",
    ]);
  });

  it("preserves single newlines inside a paragraph", () => {
    expect(splitParagraphs("Line one\nLine two")).toEqual(["Line one\nLine two"]);
  });

  it("drops empty paragraphs from extra blank lines", () => {
    expect(splitParagraphs("A\n\n\n\nB\n\n  \n\nC")).toEqual(["A", "B", "C"]);
  });

  it("normalizes CRLF newlines", () => {
    expect(splitParagraphs("A\r\n\r\nB")).toEqual(["A", "B"]);
  });

  it("does not interpret markdown or HTML, only splits text", () => {
    // Raw text is returned verbatim; rendering escapes it (see render test below).
    expect(splitParagraphs("<b>hi</b>")).toEqual(["<b>hi</b>"]);
  });
});

// ─── acceptanceEmailSubject ─────────────────────────────────

describe("acceptanceEmailSubject", () => {
  it("falls back to the legacy default when no custom subject", () => {
    expect(acceptanceEmailSubject(null, "Munich Match")).toBe(
      "You're in! Accepted for Munich Match"
    );
    expect(acceptanceEmailSubject("", "Munich Match")).toBe(
      "You're in! Accepted for Munich Match"
    );
    expect(acceptanceEmailSubject("   ", "Munich Match")).toBe(
      "You're in! Accepted for Munich Match"
    );
  });

  it("uses the trimmed custom subject when set", () => {
    expect(acceptanceEmailSubject("  See you there!  ", "Munich Match")).toBe(
      "See you there!"
    );
  });
});

// ─── sanitizeBroadcastStatuses ──────────────────────────────

describe("sanitizeBroadcastStatuses", () => {
  it("keeps only broadcastable statuses", () => {
    expect(
      sanitizeBroadcastStatuses(["accepted", "checked_in", "waitlisted"])
    ).toEqual(["accepted", "checked_in", "waitlisted"]);
  });

  it("drops rejected, cancelled and pending even if requested", () => {
    expect(
      sanitizeBroadcastStatuses([
        "accepted",
        "rejected",
        "cancelled",
        "pending",
      ])
    ).toEqual(["accepted"]);
  });

  it("dedupes and ignores unknown values", () => {
    expect(
      sanitizeBroadcastStatuses(["accepted", "accepted", "bogus"])
    ).toEqual(["accepted"]);
  });

  it("returns empty for null/empty input", () => {
    expect(sanitizeBroadcastStatuses(null)).toEqual([]);
    expect(sanitizeBroadcastStatuses([])).toEqual([]);
  });

  it("only allows the documented status set", () => {
    expect(BROADCASTABLE_STATUSES).toEqual([
      "accepted",
      "checked_in",
      "waitlisted",
    ]);
  });
});

// ─── Email body is escaped, never executed ──────────────────

describe("chapter broadcast rendering", () => {
  it("escapes HTML/script in admin-authored body (no injection)", async () => {
    const html = await renderChapterBroadcastEmail({
      subject: "Hi",
      paragraphs: splitParagraphs("<script>alert(1)</script>"),
      chapterName: "Munich Match",
    });
    // The raw tag must not appear; it must be HTML-entity escaped.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
