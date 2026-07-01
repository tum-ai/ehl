import { describe, it, expect, vi, beforeEach } from "vitest";

// Codex review gap: the CV-route test mocks getShowcaseCvFileId, so it never
// proves the REAL helper enforces chapter ownership + consent at the query
// layer. This test exercises the real getShowcaseCvFileId against a fake
// Supabase builder and asserts the exact query shape:
//   - filters by application id
//   - filters by chapter_id (IDOR guard)
//   - applies the sponsor-consent .or() filter
// and that it fails closed when the row has no CV or fails the in-code consent
// re-check.

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getShowcaseCvFileId } from "@/lib/queries/showcase";
import { SPONSOR_CONSENT_OR_FILTER } from "@/lib/showcase-shared";

// Records every filter call so we can assert the query shape, and returns a
// caller-provided row from maybeSingle().
function makeDb(row: unknown) {
  const calls = { eq: [] as Array<[string, unknown]>, or: [] as string[], table: "" };
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
    maybeSingle: () => Promise.resolve({ data: row }),
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
const APP = "app-1";

describe("getShowcaseCvFileId (real query shape)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by application id, chapter_id, and the consent .or(); returns the fileId", async () => {
    const { client, calls } = makeDb({
      cv_url: "drive-file-1",
      consent_sponsor_data: true,
      consent_recruiting: false,
    });
    mocks.createAdminClient.mockReturnValue(client);

    const fileId = await getShowcaseCvFileId(CHAPTER, APP);

    expect(fileId).toBe("drive-file-1");
    expect(calls.table).toBe("applications");
    expect(calls.eq).toContainEqual(["id", APP]);
    expect(calls.eq).toContainEqual(["chapter_id", CHAPTER]); // IDOR guard
    expect(calls.or).toContain(SPONSOR_CONSENT_OR_FILTER); // DB consent gate
  });

  it("returns null when the row has no CV", async () => {
    const { client } = makeDb({ cv_url: null, consent_sponsor_data: true, consent_recruiting: true });
    mocks.createAdminClient.mockReturnValue(client);
    expect(await getShowcaseCvFileId(CHAPTER, APP)).toBeNull();
  });

  it("returns null (fails closed) when the row somehow lacks consent (in-code re-check)", async () => {
    // Even if a future .or() weakening let an unconsented row through, the in-code
    // hasSponsorConsent re-check must still reject it.
    const { client } = makeDb({
      cv_url: "drive-file-1",
      consent_sponsor_data: false,
      consent_recruiting: false,
    });
    mocks.createAdminClient.mockReturnValue(client);
    expect(await getShowcaseCvFileId(CHAPTER, APP)).toBeNull();
  });

  it("returns null when no application matches (wrong chapter / no such id)", async () => {
    const { client } = makeDb(null);
    mocks.createAdminClient.mockReturnValue(client);
    expect(await getShowcaseCvFileId(CHAPTER, "nope")).toBeNull();
  });

  it("returns null for an empty application id without querying", async () => {
    expect(await getShowcaseCvFileId(CHAPTER, "")).toBeNull();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
