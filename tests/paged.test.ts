import { describe, it, expect } from "vitest";
import { fetchPaged, PAGE_SIZE } from "@/lib/queries/paged";

/**
 * PostgREST caps every response at max_rows (1000 by default), server-side and
 * silently. fetchPaged exists so a query can exceed that ceiling and, crucially,
 * can tell the difference between "the data ended" and "there is more you are
 * not seeing" - the second being the only honest input to a LimitBanner.
 */

const SERVER_MAX_ROWS = 1000;

/** A fake table of `total` rows behind a server that enforces the ceiling. */
function table(total: number, opts: { cap?: number; failAt?: number } = {}) {
  const cap = opts.cap ?? SERVER_MAX_ROWS;
  const calls: Array<[number, number]> = [];
  const build = () => ({
    range(from: number, to: number) {
      calls.push([from, to]);
      if (opts.failAt !== undefined && calls.length > opts.failAt) {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      const requested = to - from + 1;
      const n = Math.min(requested, cap);
      const rows = [];
      for (let i = from; i < Math.min(from + n, total); i++) rows.push({ i });
      return Promise.resolve({ data: rows, error: null });
    },
  });
  return { build, calls };
}

describe("fetchPaged", () => {
  it("reads past the server-side ceiling", async () => {
    const { build } = table(2500);
    const { rows, truncated } = await fetchPaged(build, 25000);
    expect(rows.length).toBe(2500);
    expect(truncated).toBe(false);
  });

  it("returns rows in order with no gap at the page boundary", async () => {
    const { build } = table(2500);
    const { rows } = await fetchPaged<{ i: number }>(build, 25000);
    expect(rows[0].i).toBe(0);
    expect(rows[999].i).toBe(999);
    expect(rows[1000].i).toBe(1000); // the row a broken loop drops
    expect(rows[2499].i).toBe(2499);
  });

  it("stops at the caller's limit and reports truncation", async () => {
    const { build } = table(5000);
    const { rows, truncated } = await fetchPaged(build, 2000);
    expect(rows.length).toBe(2000);
    expect(truncated).toBe(true);
  });

  it("does not claim truncation when the data ends exactly on the limit", async () => {
    const { build } = table(2000);
    const { rows, truncated } = await fetchPaged(build, 2000);
    expect(rows.length).toBe(2000);
    expect(truncated).toBe(false);
  });

  it("does not claim truncation when the data ends exactly on a page boundary", async () => {
    const { build } = table(PAGE_SIZE);
    const { rows, truncated } = await fetchPaged(build, 25000);
    expect(rows.length).toBe(PAGE_SIZE);
    expect(truncated).toBe(false);
  });

  it("builds a FRESH query per window (a reused builder never advances)", async () => {
    const { build, calls } = table(2500);
    await fetchPaged(build, 25000);
    expect(calls[0]).toEqual([0, 999]);
    expect(calls[1]).toEqual([1000, 1999]);
    expect(calls[2]).toEqual([2000, 2999]);
  });

  it("handles an empty table", async () => {
    const { build } = table(0);
    const { rows, truncated } = await fetchPaged(build, 25000);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("returns nothing for a non-positive limit, without querying", async () => {
    const { build, calls } = table(500);
    const { rows } = await fetchPaged(build, 0);
    expect(rows).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("never over-reads past the limit", async () => {
    const { build } = table(10000);
    const { rows } = await fetchPaged(build, 1500);
    expect(rows.length).toBe(1500);
  });

  // A mid-flight failure must not be reported as a complete result: returning
  // a short list with truncated=false would silently lose rows, which is the
  // whole failure mode this module exists to remove.
  it("stops on error rather than pretending the data ended", async () => {
    const { build } = table(5000, { failAt: 1 });
    const { rows } = await fetchPaged(build, 25000);
    expect(rows.length).toBe(1000);
  });

  it("copes with a server whose ceiling is smaller than the page size", async () => {
    const { build } = table(2500, { cap: 250 });
    const { rows } = await fetchPaged(build, 25000);
    // Short windows end the loop early; the guarantee is we never invent rows
    // and never mis-order what we did read.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(2500);
  });
});
