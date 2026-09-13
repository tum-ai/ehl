import { describe, it, expect } from "vitest";
import {
  BLOCK_ACTION,
  blockSide,
  blockLabel,
  summarizeBlocks,
  type BlockReason,
} from "@/lib/submission-blocks";

const ALL_REASONS: BlockReason[] = [
  "not_team_member",
  "not_checked_in",
  "not_registered",
  "submissions_locked",
  "deadline_passed",
  "entire_missing",
  "entire_repo_unreadable",
  "entire_check_unavailable",
];

describe("blockSide", () => {
  // The operational split: "ours" means the desk cannot help those teams.
  it("marks only the failed session-record check as ours", () => {
    expect(blockSide("entire_check_unavailable")).toBe("ours");
    for (const r of ALL_REASONS.filter((x) => x !== "entire_check_unavailable")) {
      expect(blockSide(r)).toBe("theirs");
    }
  });

  it("does not treat a missing Entire record as our problem", () => {
    // The team genuinely has no record: that is theirs to fix, and conflating it
    // with our own failure would hide real incidents in the noise.
    expect(blockSide("entire_missing")).toBe("theirs");
    expect(blockSide("entire_repo_unreadable")).toBe("theirs");
  });
});

describe("blockLabel", () => {
  it("labels every reason with something an operator can act on", () => {
    for (const r of ALL_REASONS) {
      const label = blockLabel(r);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(r);
      expect(label).not.toContain("—");
    }
  });
});

describe("summarizeBlocks", () => {
  it("counts attempts and distinct teams separately", () => {
    // One team retrying five times is one stuck team, not five.
    const rows = [
      { reason: "entire_missing", teamId: "team-1" },
      { reason: "entire_missing", teamId: "team-1" },
      { reason: "entire_missing", teamId: "team-1" },
      { reason: "entire_missing", teamId: "team-2" },
    ];

    const summary = summarizeBlocks(rows, 60);

    expect(summary.total).toBe(4);
    expect(summary.counts).toHaveLength(1);
    expect(summary.counts[0].count).toBe(4);
    expect(summary.counts[0].teams).toBe(2);
  });

  it("totals only our-side reasons in ourSideTotal", () => {
    const rows = [
      { reason: "entire_check_unavailable", teamId: "team-1" },
      { reason: "entire_check_unavailable", teamId: "team-2" },
      { reason: "not_checked_in", teamId: "team-3" },
      { reason: "deadline_passed", teamId: "team-4" },
    ];

    const summary = summarizeBlocks(rows, 60);

    expect(summary.total).toBe(4);
    expect(summary.ourSideTotal).toBe(2);
  });

  it("is zero-safe on an empty window", () => {
    const summary = summarizeBlocks([], 30);
    expect(summary).toEqual({ windowMinutes: 30, total: 0, ourSideTotal: 0, counts: [] });
  });

  it("orders by frequency so the biggest problem reads first", () => {
    const rows = [
      { reason: "not_checked_in", teamId: "a" },
      { reason: "entire_missing", teamId: "b" },
      { reason: "entire_missing", teamId: "c" },
      { reason: "entire_missing", teamId: "d" },
      { reason: "deadline_passed", teamId: "e" },
      { reason: "deadline_passed", teamId: "f" },
    ];

    const summary = summarizeBlocks(rows, 60);

    expect(summary.counts.map((c) => c.reason)).toEqual([
      "entire_missing",
      "deadline_passed",
      "not_checked_in",
    ]);
  });

  it("tolerates a row with no team id without inflating the team count", () => {
    const rows = [
      { reason: "not_registered", teamId: null },
      { reason: "not_registered", teamId: null },
    ];

    const summary = summarizeBlocks(rows, 60);

    expect(summary.counts[0].count).toBe(2);
    expect(summary.counts[0].teams).toBe(0);
  });

  it("does not crash on an unrecognized reason from an older log row", () => {
    // event_log is append-only, so rows written by earlier code outlive any
    // rename of the reason codes.
    const summary = summarizeBlocks([{ reason: "some_retired_reason", teamId: "t" }], 60);
    expect(summary.total).toBe(1);
    expect(summary.counts[0].side).toBe("theirs");
    expect(summary.counts[0].label).toBe("some_retired_reason");
  });
});

describe("BLOCK_ACTION", () => {
  it("follows the entity.verb convention of the event log", () => {
    expect(BLOCK_ACTION).toBe("submission.blocked");
    expect(BLOCK_ACTION).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});
