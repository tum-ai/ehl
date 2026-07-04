import { describe, it, expect, vi, beforeEach } from "vitest";

// getShowcaseCounts powers the admin "what partners will see" card. It must be
// EXACT at any scale: four head-only COUNT queries (total, consented,
// consented+checked-in, consented+CV), no row transfer, no LIMIT clipping — a
// capped row fetch would misattribute truncated-but-consented applicants as
// "no consent" and the admin would share the link based on wrong numbers.

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getShowcaseCounts } from "@/lib/queries/showcase";
import { SPONSOR_CONSENT_OR_FILTER } from "@/lib/showcase-shared";

// Thenable query builder: records the filters applied, resolves to the count
// the test derives from those filters.
function makeCountDb(counts: {
  total: number;
  visible: number;
  participants: number;
  cvs: number;
}) {
  const queries: Array<{ or: string[]; not: string[] }> = [];
  return {
    queries,
    client: {
      from() {
        const q = { or: [] as string[], not: [] as string[] };
        queries.push(q);
        const builder = {
          select: () => builder,
          eq: () => builder,
          or: (f: string) => {
            q.or.push(f);
            return builder;
          },
          not: (col: string) => {
            q.not.push(col);
            return builder;
          },
          then(resolve: (v: { count: number; error: null }) => void) {
            let count = counts.total;
            if (q.or.length > 0 && q.not.length === 0) count = counts.visible;
            if (q.not.includes("checked_in_at")) count = counts.participants;
            if (q.not.includes("cv_url")) count = counts.cvs;
            resolve({ count, error: null });
          },
        };
        return builder;
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getShowcaseCounts", () => {
  it("returns exact counts from four head-count queries (no row fetch, no cap)", async () => {
    const { client, queries } = makeCountDb({
      // Deliberately ABOVE the 2000-row applications limit: head counts must
      // stay exact where a row fetch would have clipped.
      total: 3000,
      visible: 2500,
      participants: 1200,
      cvs: 2100,
    });
    mocks.createAdminClient.mockReturnValue(client);

    const counts = await getShowcaseCounts("chapter-a");

    expect(counts).toEqual({
      total: 3000,
      visible: 2500,
      hiddenNoConsent: 500,
      participants: 1200,
      cvsAvailable: 2100,
    });
    // Four queries; the three consent-gated ones all carry the shared filter.
    expect(queries).toHaveLength(4);
    expect(queries.filter((q) => q.or.includes(SPONSOR_CONSENT_OR_FILTER))).toHaveLength(3);
  });

  it("throws when any count query fails (admin must not act on wrong numbers)", async () => {
    const failing = {
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          or: () => builder,
          not: () => builder,
          then(resolve: (v: { count: number | null; error: Error | null }) => void) {
            resolve({ count: null, error: new Error("boom") });
          },
        };
        return builder;
      },
    };
    mocks.createAdminClient.mockReturnValue(failing);

    await expect(getShowcaseCounts("chapter-a")).rejects.toThrow("boom");
  });
});
