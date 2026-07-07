import { describe, it, expect, vi, beforeEach } from "vitest";

// The bulk CV download pages getShowcaseCvList() across SEPARATE requests via
// offset/limit. Postgres does not guarantee a stable row order for a
// non-unique sort key, so if the list were ordered by last_name alone, two
// same-last_name rows could come back in a different order per request and a
// batch boundary could skip or duplicate a CV. This pins the FULLY
// deterministic order (last_name, first_name, id) that makes offset paging safe.

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getShowcaseCvList } from "@/lib/queries/showcase";
import { SPONSOR_CONSENT_OR_FILTER } from "@/lib/showcase-shared";

// Records the query shape and returns caller-provided rows.
function makeDb(rows: unknown[]) {
  const calls = {
    eq: [] as Array<[string, unknown]>,
    or: [] as string[],
    not: [] as Array<[string, string, unknown]>,
    order: [] as string[],
    table: "",
  };
  const builder = {
    select: () => builder,
    eq: (k: string, v: unknown) => {
      calls.eq.push([k, v]);
      return builder;
    },
    or: (f: string) => {
      calls.or.push(f);
      return builder;
    },
    not: (c: string, op: string, v: unknown) => {
      calls.not.push([c, op, v]);
      return builder;
    },
    order: (k: string) => {
      calls.order.push(k);
      return builder;
    },
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    client: {
      from(table: string) {
        calls.table = table;
        return builder;
      },
    },
    calls,
  };
}

const CHAPTER = "chapter-a";

beforeEach(() => vi.clearAllMocks());

describe("getShowcaseCvList (deterministic order for safe offset paging)", () => {
  it("orders by last_name, then first_name, then id (fully deterministic)", async () => {
    const { client, calls } = makeDb([]);
    mocks.createAdminClient.mockReturnValue(client);

    await getShowcaseCvList(CHAPTER);

    expect(calls.table).toBe("applications");
    // The tie-breakers after last_name are what make paging across requests safe.
    expect(calls.order).toEqual(["last_name", "first_name", "id"]);
  });

  it("applies the chapter, consent, and cv-not-null gates before ordering", async () => {
    const { client, calls } = makeDb([]);
    mocks.createAdminClient.mockReturnValue(client);

    await getShowcaseCvList(CHAPTER);

    expect(calls.eq).toContainEqual(["chapter_id", CHAPTER]);
    expect(calls.or).toContain(SPONSOR_CONSENT_OR_FILTER);
    expect(calls.not).toContainEqual(["cv_url", "is", null]);
  });

  it("re-checks consent in code and maps cv_url to fileId", async () => {
    const { client } = makeDb([
      { id: "a1", first_name: "Ada", last_name: "Lovelace", cv_url: "f1", consent_sponsor_data: true, consent_recruiting: false },
      { id: "a2", first_name: "Alan", last_name: "Turing", cv_url: "f2", consent_sponsor_data: false, consent_recruiting: false },
    ]);
    mocks.createAdminClient.mockReturnValue(client);

    const result = await getShowcaseCvList(CHAPTER);

    // The second row has neither consent flag -> dropped by the in-code re-check.
    expect(result).toEqual([{ firstName: "Ada", lastName: "Lovelace", fileId: "f1" }]);
  });
});
