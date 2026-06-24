import { describe, it, expect } from "vitest";
import {
  summarizeReviewStatuses,
  shouldKeepPolling,
  type SummarizableReview,
} from "@/lib/code-review/status-summary";
import type { CodeReviewStatus } from "@/lib/types";

describe("summarizeReviewStatuses", () => {
  it("counts each status and treats submissions without a row as pending", () => {
    const reviews: SummarizableReview[] = [
      { status: "queued" },
      { status: "queued" },
      { status: "processing" },
      { status: "completed", costUsd: 0.5 },
      { status: "failed" },
    ];
    // 8 submissions total, 5 have review rows -> 3 pending (no row).
    const s = summarizeReviewStatuses(reviews, 8);

    expect(s.queued).toBe(2);
    expect(s.processing).toBe(1);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.pending).toBe(3);
    expect(s.total).toBe(8);
    // Counts must reconcile with the total: nothing silently missing.
    expect(s.queued + s.processing + s.completed + s.failed + s.pending).toBe(8);
  });

  it("sums cost across reviews", () => {
    const reviews: SummarizableReview[] = [
      { status: "completed", costUsd: 0.25 },
      { status: "completed", costUsd: 0.75 },
      { status: "failed", costUsd: null },
      { status: "queued" },
    ];
    const s = summarizeReviewStatuses(reviews, 4);
    expect(s.totalCostUsd).toBeCloseTo(1.0, 6);
  });

  it("reports inFlight when anything is queued or processing", () => {
    expect(summarizeReviewStatuses([{ status: "queued" }], 1).inFlight).toBe(true);
    expect(summarizeReviewStatuses([{ status: "processing" }], 1).inFlight).toBe(true);
    expect(
      summarizeReviewStatuses([{ status: "completed" }, { status: "failed" }], 2).inFlight
    ).toBe(false);
    expect(summarizeReviewStatuses([], 3).inFlight).toBe(false);
  });

  it("counts explicit 'pending' rows as pending too", () => {
    const s = summarizeReviewStatuses(
      [{ status: "pending" as CodeReviewStatus }, { status: "completed" }],
      5
    );
    // 1 explicit pending + 3 with no row at all = 4 pending.
    expect(s.pending).toBe(4);
    expect(s.completed).toBe(1);
  });

  it("clamps pending at zero when there are more rows than submissions", () => {
    const s = summarizeReviewStatuses(
      [{ status: "completed" }, { status: "completed" }, { status: "completed" }],
      2
    );
    expect(s.pending).toBe(0);
    expect(s.completed).toBe(3);
  });
});

describe("shouldKeepPolling", () => {
  it("keeps polling while anything is queued or processing", () => {
    expect(shouldKeepPolling(["queued"])).toBe(true);
    expect(shouldKeepPolling(["completed", "processing"])).toBe(true);
    expect(shouldKeepPolling(["failed", "queued", "completed"])).toBe(true);
  });

  it("stops polling once everything is settled", () => {
    expect(shouldKeepPolling(["completed", "failed"])).toBe(false);
    expect(shouldKeepPolling(["completed"])).toBe(false);
    expect(shouldKeepPolling(["pending"])).toBe(false);
    expect(shouldKeepPolling([])).toBe(false);
  });
});
