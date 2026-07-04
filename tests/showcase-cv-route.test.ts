import { describe, it, expect, vi, beforeEach } from "vitest";

// The showcase CV proxy (`/api/showcase/[token]/cv/[applicationId]`) streams an
// applicant's CV to a partner holding a valid, LIVE showcase token. Access MUST
// require ALL of:
//   - the token resolves to an enabled, unexpired showcase (getShowcaseByToken);
//   - that showcase has show_cvs on;
//   - the application id belongs to THAT chapter and passes the consent gate
//     (getShowcaseCvFileId returns the fileId only then).
// A token for chapter A must NOT be able to fetch a CV from chapter B, and a
// disabled/expired token must never stream anything. Every failure is a uniform
// 404 (no existence oracle).

// Rate limiting is NOT mocked here because the route does not rate-limit
// itself: the per-IP limiter lives inside getShowcaseByToken (mocked below),
// shared by every resolver consumer — see tests/showcase-resolver.test.ts.
const mocks = vi.hoisted(() => ({
  getShowcaseByToken: vi.fn(),
  getShowcaseCvFileId: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/lib/actions/showcase", () => ({
  getShowcaseByToken: mocks.getShowcaseByToken,
}));
vi.mock("@/lib/queries/showcase", () => ({
  getShowcaseCvFileId: mocks.getShowcaseCvFileId,
}));
vi.mock("@/lib/gdrive", () => ({
  downloadFile: mocks.downloadFile,
}));

import { GET } from "@/app/api/showcase/[token]/cv/[applicationId]/route";

const TOKEN_A = "token-for-chapter-a";
const CHAPTER_A = "chapter-a";
const APP_IN_A = "application-in-a";
const APP_IN_B = "application-in-b";
const FILE_A = "drive-file-a";

function paramsFor(token: string, applicationId: string) {
  return { params: Promise.resolve({ token, applicationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: token A resolves to a live showcase for chapter A with CVs enabled.
  mocks.getShowcaseByToken.mockResolvedValue({ chapterId: CHAPTER_A, showCvs: true });
  // Default: only APP_IN_A belongs to chapter A and is consented -> yields FILE_A.
  mocks.getShowcaseCvFileId.mockImplementation(async (chapterId: string, appId: string) =>
    chapterId === CHAPTER_A && appId === APP_IN_A ? FILE_A : null
  );
  mocks.downloadFile.mockResolvedValue({
    buffer: Buffer.from("PDFBYTES"),
    mimeType: "application/pdf",
  });
});

describe("GET /api/showcase/[token]/cv/[applicationId]", () => {
  it("streams the CV for a valid token + application in its chapter (happy path)", async () => {
    const res = await GET(new Request("http://t/"), paramsFor(TOKEN_A, APP_IN_A));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // CVs must never be cached by a CDN/browser and must stay out of indexes.
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(mocks.getShowcaseCvFileId).toHaveBeenCalledWith(CHAPTER_A, APP_IN_A);
    expect(mocks.downloadFile).toHaveBeenCalledWith(FILE_A);
  });

  it("does NOT let a token for chapter A fetch a CV from chapter B", async () => {
    // APP_IN_B belongs to chapter B; getShowcaseCvFileId is called with chapter A
    // (from the token) and app B, so it returns null -> 404, nothing streamed.
    const res = await GET(new Request("http://t/"), paramsFor(TOKEN_A, APP_IN_B));

    expect(res.status).toBe(404);
    expect(mocks.getShowcaseCvFileId).toHaveBeenCalledWith(CHAPTER_A, APP_IN_B);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("404s when the token is invalid/disabled/expired (getShowcaseByToken -> null)", async () => {
    mocks.getShowcaseByToken.mockResolvedValue(null);

    const res = await GET(new Request("http://t/"), paramsFor("bad-token", APP_IN_A));

    expect(res.status).toBe(404);
    expect(mocks.getShowcaseCvFileId).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("404s when the showcase has CVs turned off (show_cvs=false)", async () => {
    mocks.getShowcaseByToken.mockResolvedValue({ chapterId: CHAPTER_A, showCvs: false });

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN_A, APP_IN_A));

    expect(res.status).toBe(404);
    expect(mocks.getShowcaseCvFileId).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("404s when the application has no CV or no consent (getShowcaseCvFileId -> null)", async () => {
    mocks.getShowcaseCvFileId.mockResolvedValue(null);

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN_A, APP_IN_A));

    expect(res.status).toBe(404);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("honors ?download=1 with an attachment disposition (inline otherwise)", async () => {
    const res = await GET(
      new Request("http://t/cv?download=1"),
      paramsFor(TOKEN_A, APP_IN_A)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("answers the uniform 404 when the resolver rate-limits (null), never streaming", async () => {
    // Rate limiting lives inside getShowcaseByToken (shared per-IP bucket for
    // every resolver consumer); a limited resolver returns null and the route
    // must map that to the same 404 as any other miss (no rate-limit oracle).
    mocks.getShowcaseByToken.mockResolvedValue(null);

    const res = await GET(new Request("http://t/"), paramsFor(TOKEN_A, APP_IN_A));

    expect(res.status).toBe(404);
    expect(mocks.getShowcaseCvFileId).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });
});
