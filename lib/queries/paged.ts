/**
 * Paged reads that survive PostgREST's server-side row ceiling.
 *
 * Supabase caps EVERY response at `max_rows` (supabase/config.toml, and
 * Settings -> API -> Max rows in a hosted project; 1000 by default). That cap is
 * applied server-side and silently: `.limit(25000)` still returns 1000 rows, and
 * nothing in the response says it was cut.
 *
 * That made raising QUERY_LIMITS above 1000 worse than useless. The admin Teams
 * page showed exactly 1000 participants, and because LimitBanner compared the
 * returned count against the CONFIGURED limit (1000 < 25000), no banner fired:
 * the truncation became invisible, which is the one outcome the limit rules
 * exist to prevent.
 *
 * `fetchPaged` walks `.range()` windows until the data runs out or the caller's
 * limit is reached, so the ceiling stops being a data cap. It also reports
 * whether it stopped because MORE ROWS EXIST, which is the only honest input to
 * a "there is more data" banner.
 */

// Window size per request. Kept at the common PostgREST default so a single
// window is never rejected; a smaller ceiling still works (the loop just sees
// short pages and stops early), it only costs extra round trips.
export const PAGE_SIZE = 1000;

/** A PostgREST query builder narrowed to what paging needs. */
export interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

export interface PagedResult<T> {
  rows: T[];
  /**
   * True when rows were left unread because `limit` was reached, NOT when the
   * table simply ended. This is what a LimitBanner must be driven by: the old
   * `count >= limit` test cannot tell "exactly at the limit" from "cut off",
   * and cannot see a server-side cap at all.
   */
  truncated: boolean;
}

/**
 * Read up to `limit` rows, one window at a time.
 *
 * `build` is called per window and must return a fresh builder: PostgREST
 * builders are single-use, so reusing one silently returns the first window
 * again and the loop would never advance.
 */
export async function fetchPaged<T>(
  build: () => RangeQuery<T>,
  limit: number,
  pageSize: number = PAGE_SIZE
): Promise<PagedResult<T>> {
  if (limit <= 0) return { rows: [], truncated: false };

  const rows: T[] = [];
  const step = Math.max(1, Math.min(pageSize, limit));

  for (let offset = 0; offset < limit; offset += step) {
    const window = Math.min(step, limit - offset);
    const { data, error } = await build().range(offset, offset + window - 1);

    if (error || !data) break;
    rows.push(...data);

    // A short window means the table ended: nothing more to read.
    if (data.length < window) return { rows, truncated: false };
  }

  // We stopped because `limit` was reached. Ask for one more row: if it exists,
  // the caller really is seeing a truncated view and must say so.
  if (rows.length >= limit) {
    const { data } = await build().range(limit, limit);
    return { rows, truncated: !!data && data.length > 0 };
  }

  return { rows, truncated: false };
}
