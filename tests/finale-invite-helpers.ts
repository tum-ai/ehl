import { vi } from "vitest";

/**
 * Recording Supabase stub for the Grand Finale invite tests.
 *
 * The real client's query builder is thenable, so every chain must be awaitable
 * directly as well as through .single()/.maybeSingle(). Results are looked up
 * per table and per operation, and every operation is recorded so a test can
 * assert what was written, and (for the invite page) that NOTHING was.
 */

export interface RecordedCall {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
}

export type TableResult = { data: unknown; error: unknown } | (() => { data: unknown; error: unknown });

export interface DbFixture {
  /** Result per table for reads, e.g. { leaderboard: { data: [...], error: null } }. */
  select?: Record<string, TableResult>;
  insert?: Record<string, TableResult>;
  update?: Record<string, TableResult>;
  delete?: Record<string, TableResult>;
}

const EMPTY = { data: null, error: null };

function resolve(fixture: TableResult | undefined) {
  if (!fixture) return EMPTY;
  return typeof fixture === "function" ? fixture() : fixture;
}

export function makeDb(fixture: DbFixture) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const rec: RecordedCall = { table, op: "select" };
    let recorded = false;

    const record = () => {
      if (recorded) return;
      recorded = true;
      calls.push(rec);
    };

    const result = () => {
      record();
      return resolve(fixture[rec.op]?.[table]);
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      is: () => builder,
      lte: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (payload: Record<string, unknown>) => {
        rec.op = "insert";
        rec.payload = payload;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        rec.op = "update";
        rec.payload = payload;
        return builder;
      },
      delete: () => {
        rec.op = "delete";
        return builder;
      },
      single: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled),
    };
    return builder;
  });

  return { db: { from }, calls };
}

/** Every write the stub saw. The invite page must produce an empty list. */
export function writes(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.op !== "select");
}

/** Narrows the discriminated union, failing loudly if the action errored. */
export function ok<T extends object>(result: { error: string } | T): T {
  if ("error" in result) throw new Error(`Expected success, got error: ${result.error}`);
  return result;
}
