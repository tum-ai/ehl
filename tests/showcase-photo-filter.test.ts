import { describe, it, expect, vi, beforeEach } from "vitest";

// filterChapterPhotoFileIds is the server-side guard the photo ZIP route relies
// on: it must keep ONLY the requested ids that are genuinely this chapter's
// gallery photos, so a caller-supplied selection can never smuggle a foreign
// Drive id (e.g. a CV) into the archive. It also must query the media table
// scoped to (chapter_id, type = "photo") and preserve the gallery order.

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("@/lib/queries/client", () => ({ getClient: mocks.getClient }));
// createAdminClient is imported by the module but unused on these paths.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  filterChapterPhotoFileIds,
  getShowcasePhotoList,
} from "@/lib/queries/showcase";

// Fake Supabase builder that records the query shape and returns rows.
function makeDb(rows: unknown[]) {
  const calls = { eq: [] as Array<[string, unknown]>, order: [] as string[], table: "" };
  const builder = {
    select: () => builder,
    eq: (k: string, v: unknown) => {
      calls.eq.push([k, v]);
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

describe("getShowcasePhotoList (real query shape)", () => {
  it("queries media scoped to chapter_id + type=photo, featured-first, mapping url->fileId", async () => {
    const { client, calls } = makeDb([
      { url: "p1", caption: "hero", type: "photo" },
      { url: "p2", caption: null, type: "photo" },
    ]);
    mocks.getClient.mockReturnValue(client);

    const result = await getShowcasePhotoList(CHAPTER);

    expect(calls.table).toBe("media");
    expect(calls.eq).toContainEqual(["chapter_id", CHAPTER]);
    expect(calls.eq).toContainEqual(["type", "photo"]);
    expect(calls.order).toContain("featured");
    expect(result).toEqual([
      { fileId: "p1", caption: "hero" },
      { fileId: "p2", caption: null },
    ]);
  });

  it("drops rows with no url (defensive)", async () => {
    const { client } = makeDb([
      { url: "p1", caption: null, type: "photo" },
      { url: null, caption: null, type: "photo" },
    ]);
    mocks.getClient.mockReturnValue(client);

    const result = await getShowcasePhotoList(CHAPTER);
    expect(result.map((p) => p.fileId)).toEqual(["p1"]);
  });
});

describe("filterChapterPhotoFileIds (selection guard)", () => {
  it("keeps only requested ids that are real chapter photos, in gallery order", async () => {
    const { client } = makeDb([
      { url: "p1", caption: null, type: "photo" },
      { url: "p2", caption: null, type: "photo" },
      { url: "p3", caption: null, type: "photo" },
    ]);
    mocks.getClient.mockReturnValue(client);

    // Requested out of order, and includes a smuggled non-photo id.
    const result = await filterChapterPhotoFileIds(CHAPTER, ["p3", "cv-secret", "p1"]);

    // Smuggled id dropped; order follows the gallery (featured-first), not the request.
    expect(result).toEqual(["p1", "p3"]);
  });

  it("returns [] for an empty request without querying", async () => {
    mocks.getClient.mockReturnValue(makeDb([]).client);
    const result = await filterChapterPhotoFileIds(CHAPTER, []);
    expect(result).toEqual([]);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("returns [] when none of the requested ids are chapter photos", async () => {
    const { client } = makeDb([{ url: "p1", caption: null, type: "photo" }]);
    mocks.getClient.mockReturnValue(client);
    const result = await filterChapterPhotoFileIds(CHAPTER, ["cv-a", "cv-b"]);
    expect(result).toEqual([]);
  });
});
