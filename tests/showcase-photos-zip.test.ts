import { describe, it, expect, vi, beforeEach } from "vitest";

// The bulk-photo ZIP endpoint must: enforce the token gate (live token only),
// download ALL photos when no selection is sent, download ONLY the selected
// fileIds when a selection is sent, NEVER trust the caller-supplied selection
// (smuggled ids that are not the chapter's photos are dropped), refuse loudly
// above the cap (413), rate-limit before any work, and keep streaming past
// individual Drive failures (skipped photos listed in the manifest).

const mocks = vi.hoisted(() => ({
  getShowcaseByToken: vi.fn(),
  getShowcasePhotoList: vi.fn(),
  filterChapterPhotoFileIds: vi.fn(),
  downloadFile: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/actions/showcase", () => ({
  getShowcaseByToken: mocks.getShowcaseByToken,
}));
vi.mock("@/lib/queries/showcase", () => ({
  getShowcasePhotoList: mocks.getShowcasePhotoList,
  filterChapterPhotoFileIds: mocks.filterChapterPhotoFileIds,
}));
vi.mock("@/lib/gdrive", () => ({ downloadFile: mocks.downloadFile }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  showcasePhotoZipLimiter: { prefix: "rl:showcase-photo-zip" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { POST } from "@/app/api/showcase/[token]/photos/route";
import { QUERY_LIMITS } from "@/lib/config/limits";

const TOKEN = "token-a";

function paramsFor(token: string) {
  return { params: Promise.resolve({ token }) };
}

function req(body?: unknown) {
  return new Request("http://t/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ALL_PHOTOS = [
  { fileId: "p1", caption: null },
  { fileId: "p2", caption: null },
  { fileId: "p3", caption: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.getShowcaseByToken.mockResolvedValue({ chapterId: "chapter-a", showCvs: true });
  mocks.getShowcasePhotoList.mockResolvedValue(ALL_PHOTOS);
  mocks.filterChapterPhotoFileIds.mockImplementation(async (_c: string, ids: string[]) =>
    ids.filter((id) => ["p1", "p2", "p3"].includes(id))
  );
  mocks.downloadFile.mockResolvedValue({
    buffer: Buffer.from("\xff\xd8\xff-fake-jpeg"),
    mimeType: "image/jpeg",
  });
});

describe("POST /api/showcase/[token]/photos", () => {
  it("streams a ZIP with hygiene headers and all photos when no selection is sent", async () => {
    const res = await POST(req(), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const listing = bytes.toString("latin1");
    // All three photos, jpg extension from the mime type, plus the manifest.
    expect(listing).toContain("photo_001.jpg");
    expect(listing).toContain("photo_002.jpg");
    expect(listing).toContain("photo_003.jpg");
    expect(listing).toContain("_MANIFEST.txt");
    // No selection -> the whole gallery, so the selection filter is NOT used.
    expect(mocks.filterChapterPhotoFileIds).not.toHaveBeenCalled();
    expect(mocks.downloadFile).toHaveBeenCalledTimes(3);
  });

  it("downloads only the selected fileIds when a selection is sent", async () => {
    const res = await POST(req({ fileIds: ["p1", "p3"] }), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(mocks.filterChapterPhotoFileIds).toHaveBeenCalledWith("chapter-a", ["p1", "p3"]);
    expect(mocks.downloadFile).toHaveBeenCalledTimes(2);
    expect(mocks.downloadFile).toHaveBeenCalledWith("p1");
    expect(mocks.downloadFile).toHaveBeenCalledWith("p3");
  });

  it("drops smuggled fileIds that are not this chapter's photos (no IDOR/CV exfil)", async () => {
    // Client asks for a CV's fileId + one real photo. The validator keeps only
    // the real photo, so the CV is never fetched.
    const res = await POST(req({ fileIds: ["cv-secret", "p2"] }), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(mocks.filterChapterPhotoFileIds).toHaveBeenCalledWith("chapter-a", ["cv-secret", "p2"]);
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
    expect(mocks.downloadFile).toHaveBeenCalledWith("p2");
    expect(mocks.downloadFile).not.toHaveBeenCalledWith("cv-secret");
  });

  it("returns 404 when the token is not live (no download)", async () => {
    mocks.getShowcaseByToken.mockResolvedValue(null);

    const res = await POST(req(), paramsFor(TOKEN));

    expect(res.status).toBe(404);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the chapter has no photos", async () => {
    mocks.getShowcasePhotoList.mockResolvedValue([]);

    const res = await POST(req(), paramsFor(TOKEN));

    expect(res.status).toBe(404);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("returns 404 when a selection resolves to zero valid photos", async () => {
    // Only smuggled ids -> the validator returns [], so nothing to download.
    const res = await POST(req({ fileIds: ["cv-secret"] }), paramsFor(TOKEN));

    expect(res.status).toBe(404);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("refuses loudly (413) above the bulk-download cap, before any bytes stream", async () => {
    const tooMany = Array.from({ length: QUERY_LIMITS.showcasePhotoZip + 1 }, (_, i) => ({
      fileId: `x${i}`,
      caption: null,
    }));
    mocks.getShowcasePhotoList.mockResolvedValue(tooMany);

    const res = await POST(req(), paramsFor(TOKEN));

    expect(res.status).toBe(413);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("rate-limits before doing any work (429)", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "slow down" });

    const res = await POST(req(), paramsFor(TOKEN));

    expect(res.status).toBe(429);
    expect(mocks.getShowcaseByToken).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("skips a failing photo and lists it in the manifest instead of corrupting the archive", async () => {
    mocks.downloadFile.mockImplementation(async (id: string) => {
      if (id === "p2") throw new Error("drive down");
      return { buffer: Buffer.from("\xff\xd8\xff-fake"), mimeType: "image/jpeg" };
    });

    const res = await POST(req(), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const listing = bytes.toString("latin1");
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    // The archive is still a valid ZIP with the two successes + a manifest that
    // names the failure.
    expect(listing).toContain("_MANIFEST.txt");
    expect(listing).toContain("FAILED");
    expect(listing).toContain("p2");
  });

  it("uses the correct file extension from each photo's Drive mime type", async () => {
    mocks.getShowcasePhotoList.mockResolvedValue([{ fileId: "png1", caption: null }]);
    mocks.downloadFile.mockResolvedValue({
      buffer: Buffer.from("\x89PNG-fake"),
      mimeType: "image/png",
    });

    const res = await POST(req(), paramsFor(TOKEN));
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString("latin1")).toContain("photo_001.png");
  });
});
