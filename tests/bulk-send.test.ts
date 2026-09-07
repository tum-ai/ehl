import { describe, it, expect, vi } from "vitest";
import {
  runBudgetedConcurrent,
  EMAIL_SEND_CONCURRENCY,
  EMAIL_SEND_BUDGET_MS,
} from "@/lib/bulk-send";

// Scheduling for bulk transactional email: run N recipients concurrently under
// a wall-clock budget, and report the ones never started. The load-bearing
// property is that a skipped item does NOTHING at all: callers persist
// "already emailed" state inside the worker, so a half-run job would mark
// someone as handled and exclude them from every later attempt.

describe("runBudgetedConcurrent", () => {
  it("runs every item when the budget is ample", async () => {
    const seen: number[] = [];
    const items = [1, 2, 3, 4, 5];

    const { skipped } = await runBudgetedConcurrent(items, async (n) => {
      seen.push(n);
    });

    expect(seen.sort()).toEqual(items);
    expect(skipped).toEqual([]);
  });

  it("handles an empty list without calling the worker", async () => {
    const worker = vi.fn();
    const { skipped } = await runBudgetedConcurrent([], worker);
    expect(worker).not.toHaveBeenCalled();
    expect(skipped).toEqual([]);
  });

  it("limits how many run at once", async () => {
    let inFlight = 0;
    let peak = 0;

    await runBudgetedConcurrent(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
      },
      { concurrency: 3 }
    );

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("actually overlaps work rather than running sequentially", async () => {
    // A sequential loop would leave peak at 1, which is the bug this exists to
    // avoid: lib/email.ts pools 3 connections that a serial loop never uses.
    let inFlight = 0;
    let peak = 0;

    await runBudgetedConcurrent(
      Array.from({ length: 6 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
      },
      { concurrency: 3 }
    );

    expect(peak).toBe(3);
  });

  it("stops once the budget is spent and reports the rest as skipped", async () => {
    let clock = 0;
    const now = () => clock;
    const done: number[] = [];

    const { skipped } = await runBudgetedConcurrent(
      Array.from({ length: 10 }, (_, i) => i),
      async (n) => {
        done.push(n);
        clock += 20_000;
      },
      { concurrency: 1, budgetMs: 45_000, now }
    );

    // t=0 ok, t=20k ok, t=40k ok, then t=60k is past the deadline.
    expect(done).toEqual([0, 1, 2]);
    expect(skipped).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("does NOTHING for a skipped item (no partial work)", async () => {
    let clock = 0;
    const now = () => clock;
    const touched: number[] = [];

    const { skipped } = await runBudgetedConcurrent(
      [0, 1, 2, 3],
      async (n) => {
        touched.push(n);
        clock += 60_000;
      },
      { concurrency: 1, budgetMs: 45_000, now }
    );

    expect(touched).toEqual([0]);
    // The skipped ones were never handed to the worker at all.
    expect(skipped).toEqual([1, 2, 3]);
  });

  it("loses nobody: every item is either worked or skipped", async () => {
    let clock = 0;
    const now = () => clock;
    const worked: number[] = [];
    const items = Array.from({ length: 25 }, (_, i) => i);

    const { skipped } = await runBudgetedConcurrent(
      items,
      async (n) => {
        worked.push(n);
        clock += 5_000;
      },
      { concurrency: 1, budgetMs: 45_000, now }
    );

    expect(worked.length + skipped.length).toBe(items.length);
    expect([...worked, ...skipped].sort((a, b) => a - b)).toEqual(items);
  });

  it("preserves input order in the skipped list", async () => {
    let clock = 0;
    const now = () => clock;

    const { skipped } = await runBudgetedConcurrent(
      ["a", "b", "c", "d"],
      async () => {
        clock += 60_000;
      },
      { concurrency: 1, budgetMs: 45_000, now }
    );

    expect(skipped).toEqual(["b", "c", "d"]);
  });

  it("propagates a throwing worker (workers must catch their own errors)", async () => {
    await expect(
      runBudgetedConcurrent([1], async () => {
        throw new Error("worker did not catch");
      })
    ).rejects.toThrow("worker did not catch");
  });

  it("defaults concurrency to the SMTP pool size and the budget below the timeout", () => {
    expect(EMAIL_SEND_CONCURRENCY).toBe(3);
    expect(EMAIL_SEND_BUDGET_MS).toBe(45_000);
    expect(EMAIL_SEND_BUDGET_MS).toBeLessThan(60_000);
  });
});
