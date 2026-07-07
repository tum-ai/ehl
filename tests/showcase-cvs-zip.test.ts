import { describe, it, expect, vi, beforeEach } from "vitest";

// The bulk-CV ZIP endpoint must enforce the exact gating chain of the single-CV
// proxy (live token -> show_cvs on -> consent-gated CV list), serve a batch
// window (?offset=&limit=) so a large chapter downloads as several sequential
// ZIPs (the batch is applied AFTER the consent gate, so no offset can reach a
// non-consented CV), rate-limit before any work, and keep streaming past
// individual Drive failures (skipped CVs are listed in the manifest instead of
// corrupting the archive).

const mocks = vi.hoisted(() => ({
  getShowcaseByToken: vi.fn(),
  getShowcaseCvList: vi.fn(),
  downloadFile: vi.fn(),
  checkRateLimit: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/actions/showcase", () => ({
  getShowcaseByToken: mocks.getShowcaseByToken,
}));
vi.mock("@/lib/queries/showcase", () => ({
  getShowcaseCvList: mocks.getShowcaseCvList,
}));
vi.mock("@/lib/gdrive", () => ({ downloadFile: mocks.downloadFile }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  showcaseCvZipLimiter: { prefix: "rl:showcase-cv-zip" },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { GET } from "@/app/api/showcase/[token]/cvs/route";
import { QUERY_LIMITS } from "@/lib/config/limits";

const TOKEN = "token-a";

function paramsFor(token: string) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]]));
  mocks.checkRateLimit.mockResolvedValue({ limited: false });
  mocks.getShowcaseByToken.mockResolvedValue({ chapterId: "chapter-a", showCvs: true });
  mocks.getShowcaseCvList.mockResolvedValue([
    { firstName: "Ada", lastName: "Lovelace", fileId: "f1" },
    { firstName: "Alan", lastName: "Turing", fileId: "f2" },
  ]);
  mocks.downloadFile.mockResolvedValue({
    buffer: Buffer.from("%PDF-fake"),
    mimeType: "application/pdf",
  });
});

describe("GET /api/showcase/[token]/cvs", () => {
  it("streams a ZIP with hygiene headers for a live token with CVs on", async () => {
    const res = await GET(new Request("http://t/"), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");

    // The body is a real ZIP: PK signature, both CV entries + the manifest.
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const listing = bytes.toString("latin1");
    expect(listing).toContain("lovelace_ada_CV.pdf");
    expect(listing).toContain("turing_alan_CV.pdf");
    expect(listing).toContain("_MANIFEST.txt");
    expect(mocks.downloadFile).toHaveBeenCalledTimes(2);
  });

  it("404s uniformly for an invalid/disabled/expired token (resolver null)", async () => {
    mocks.getShowcaseByToken.mockResolvedValue(null);

    const res = await GET(new Request("http://t/"), paramsFor("bad"));

    expect(res.status).toBe(404);
    expect(mocks.getShowcaseCvList).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("404s when the showcase has CVs turned off", async () => {
    mocks.getShowcaseByToken.mockResolvedValue({ chapterId: "chapter-a", showCvs: false });

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN));

    expect(res.status).toBe(404);
    expect(mocks.getShowcaseCvList).not.toHaveBeenCalled();
  });

  it("serves ONLY the requested batch window (offset+limit), so a large chapter is downloadable", async () => {
    // 250 consented CVs, far above the per-ZIP cap. The client asks for the
    // second window; the route must serve exactly those, not 413 the whole set.
    mocks.getShowcaseCvList.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => ({
        firstName: `F${i}`,
        lastName: `L${i}`,
        fileId: `f${i}`,
      }))
    );

    const res = await GET(
      new Request("http://t/?offset=100&limit=100"),
      paramsFor(TOKEN)
    );

    expect(res.status).toBe(200);
    await res.arrayBuffer();
    // Exactly the 100 CVs of the window were fetched (f100..f199), not all 250.
    expect(mocks.downloadFile).toHaveBeenCalledTimes(100);
    expect(mocks.downloadFile).toHaveBeenCalledWith("f100");
    expect(mocks.downloadFile).toHaveBeenCalledWith("f199");
    expect(mocks.downloadFile).not.toHaveBeenCalledWith("f99");
    expect(mocks.downloadFile).not.toHaveBeenCalledWith("f200");
  });

  it("caps the window at the per-ZIP limit even if a larger ?limit= is requested", async () => {
    mocks.getShowcaseCvList.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({
        firstName: `F${i}`,
        lastName: `L${i}`,
        fileId: `f${i}`,
      }))
    );

    const res = await GET(new Request("http://t/?offset=0&limit=999"), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    await res.arrayBuffer();
    // Never streams more than the cap in one request, whatever the client asks.
    expect(mocks.downloadFile).toHaveBeenCalledTimes(QUERY_LIMITS.showcaseCvZip);
  });

  it("names later batches distinctly so sequential ZIPs do not overwrite", async () => {
    mocks.getShowcaseCvList.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => ({
        firstName: `F${i}`,
        lastName: `L${i}`,
        fileId: `f${i}`,
      }))
    );

    const first = await GET(new Request("http://t/?offset=0&limit=100"), paramsFor(TOKEN));
    const second = await GET(new Request("http://t/?offset=100&limit=100"), paramsFor(TOKEN));
    await first.arrayBuffer();
    await second.arrayBuffer();

    expect(first.headers.get("Content-Disposition")).toContain("ehl-cvs.zip");
    expect(second.headers.get("Content-Disposition")).toContain("ehl-cvs-2.zip");
  });

  it("404s when the offset is past the end (no empty 200 zip)", async () => {
    mocks.getShowcaseCvList.mockResolvedValue([
      { firstName: "Ada", lastName: "Lovelace", fileId: "f1" },
    ]);

    const res = await GET(new Request("http://t/?offset=100&limit=100"), paramsFor(TOKEN));

    expect(res.status).toBe(404);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("treats limit=0 as the server cap, not an empty archive", async () => {
    mocks.getShowcaseCvList.mockResolvedValue([
      { firstName: "Ada", lastName: "Lovelace", fileId: "f1" },
      { firstName: "Alan", lastName: "Turing", fileId: "f2" },
    ]);

    const res = await GET(new Request("http://t/?offset=0&limit=0"), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    await res.arrayBuffer();
    // Both CVs streamed, not an empty (manifest-only) zip.
    expect(mocks.downloadFile).toHaveBeenCalledTimes(2);
  });

  it("exposes X-CV-Total (authoritative consented count) and X-CV-Window (this batch) so the client can page", async () => {
    mocks.getShowcaseCvList.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => ({
        firstName: `F${i}`,
        lastName: `L${i}`,
        fileId: `f${i}`,
      }))
    );

    const res = await GET(new Request("http://t/?offset=200"), paramsFor(TOKEN));
    await res.arrayBuffer();

    // Total is the full consented list; the last window is the remainder (50),
    // capped at the per-ZIP limit for earlier windows.
    expect(res.headers.get("X-CV-Total")).toBe("250");
    expect(res.headers.get("X-CV-Window")).toBe("50");
  });

  it("ignores negative/non-numeric offset and limit (falls back to a valid first batch)", async () => {
    mocks.getShowcaseCvList.mockResolvedValue([
      { firstName: "Ada", lastName: "Lovelace", fileId: "f1" },
      { firstName: "Alan", lastName: "Turing", fileId: "f2" },
    ]);

    const res = await GET(new Request("http://t/?offset=-5&limit=abc"), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(mocks.downloadFile).toHaveBeenCalledTimes(2);
    expect(res.headers.get("Content-Disposition")).toContain("ehl-cvs.zip");
  });

  it("rate-limits with 429 before any token/DB/Drive work", async () => {
    mocks.checkRateLimit.mockResolvedValue({ limited: true, error: "Too many" });

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN));

    expect(res.status).toBe(429);
    expect(mocks.getShowcaseByToken).not.toHaveBeenCalled();
  });

  it("skips a failing CV and lists it in the manifest instead of corrupting the archive", async () => {
    mocks.downloadFile.mockImplementation(async (fileId: string) => {
      if (fileId === "f1") throw new Error("drive down");
      return { buffer: Buffer.from("%PDF-fake"), mimeType: "application/pdf" };
    });

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN));

    expect(res.status).toBe(200);
    const listing = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(listing).not.toContain("lovelace_ada_CV.pdf");
    expect(listing).toContain("turing_alan_CV.pdf");
    expect(listing).toContain("FAILED");
    expect(listing).toContain("Ada Lovelace");
  });

  it("404s when no CVs are available (empty consented set)", async () => {
    mocks.getShowcaseCvList.mockResolvedValue([]);

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN));

    expect(res.status).toBe(404);
  });
});
