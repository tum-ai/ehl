import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The CV proxy route (`/api/admin/cv/[fileId]`) streams an applicant's CV from
// Google Drive via the service account. Access MUST be scoped to the chapter the
// CV's owning application belongs to:
//   - a global admin can read any chapter's CVs;
//   - a local (chapter) admin can read ONLY CVs in their own chapter;
//   - a chapter admin requesting a CV from another chapter is rejected;
//   - a non-admin is rejected.
//
// The scope is enforced server-side: the route resolves the owning chapter from
// the DB (applications.cv_url == fileId) and then calls the chapter-scoped guard
// with THAT chapter id — the caller cannot supply or spoof the chapter.

const mocks = vi.hoisted(() => ({
  requireChapterAdminApi: vi.fn(),
  getSession: vi.fn(),
  createAdminClient: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminApi: mocks.requireChapterAdminApi,
}));
vi.mock("@/lib/actions/auth", () => ({
  getSession: mocks.getSession,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/gdrive", () => ({
  downloadFile: mocks.downloadFile,
}));

import { GET } from "@/app/api/admin/cv/[fileId]/route";

const FILE_IN_CHAPTER_A = "drive-file-id-aaaaaaaa";
const CHAPTER_A = "chapter-a";
const CHAPTER_B = "chapter-b";

function paramsFor(fileId: string) {
  return { params: Promise.resolve({ fileId }) };
}

// Minimal chainable Supabase builder: applications.select().eq("cv_url", x).maybeSingle()
// resolves to the row whose cv_url matches the requested fileId.
function makeDb(ownerChapterByFile: Record<string, string>) {
  return {
    from(_table: string) {
      const state: { fileId?: string } = {};
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => {
          if (k === "cv_url") state.fileId = v as string;
          return builder;
        },
        maybeSingle: () => {
          const chapterId = state.fileId ? ownerChapterByFile[state.fileId] : undefined;
          return Promise.resolve({
            data: chapterId ? { chapter_id: chapterId } : null,
          });
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default caller is a global admin so the role pre-gate passes; individual
  // tests override this (chapter admin, non-admin) as needed.
  mocks.getSession.mockResolvedValue({ user: { id: "admin-1" }, profile: { role: "admin" } });
  mocks.createAdminClient.mockReturnValue(
    makeDb({ [FILE_IN_CHAPTER_A]: CHAPTER_A })
  );
  mocks.downloadFile.mockResolvedValue({
    buffer: Buffer.from("PDFBYTES"),
    mimeType: "application/pdf",
  });
});

describe("GET /api/admin/cv/[fileId]", () => {
  it("rejects an obviously invalid (too short) file id before any DB/Drive work", async () => {
    const res = await GET(new Request("http://t/"), paramsFor("short"));

    expect(res.status).toBe(400);
    expect(mocks.requireChapterAdminApi).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("scopes the guard to the CV's OWN chapter (resolved server-side, not caller-supplied)", async () => {
    // Guard passes (global admin or matching chapter admin).
    mocks.requireChapterAdminApi.mockResolvedValue(null);

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    // The guard was called with the chapter the FILE belongs to (chapter A),
    // which the route looked up from the DB — the request carried no chapter id.
    expect(mocks.requireChapterAdminApi).toHaveBeenCalledWith(CHAPTER_A);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("lets a chapter admin read a CV in their own chapter (happy path)", async () => {
    // requireChapterAdminApi returns null for a chapter admin whose chapter is A.
    mocks.requireChapterAdminApi.mockImplementation(async (chapterId: string) =>
      chapterId === CHAPTER_A
        ? null
        : NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(200);
    expect(mocks.downloadFile).toHaveBeenCalledWith(FILE_IN_CHAPTER_A);
  });

  it("rejects a chapter-B admin requesting a CV that belongs to chapter A", async () => {
    // Simulate a local admin of chapter B: the guard denies any chapter != B.
    mocks.requireChapterAdminApi.mockImplementation(async (chapterId: string) =>
      chapterId === CHAPTER_B
        ? null
        : NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    // The route resolved chapter A from the DB, so the chapter-B admin is denied
    // and the file is never streamed.
    expect(mocks.requireChapterAdminApi).toHaveBeenCalledWith(CHAPTER_A);
    expect(res.status).toBe(403);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("still serves global admins (guard passes for any chapter)", async () => {
    // Global admin: requireChapterAdminApi returns null regardless of chapter.
    mocks.requireChapterAdminApi.mockResolvedValue(null);

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(200);
    expect(mocks.downloadFile).toHaveBeenCalledWith(FILE_IN_CHAPTER_A);
  });

  it("rejects a non-admin (guard denies)", async () => {
    mocks.requireChapterAdminApi.mockResolvedValue(
      NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(403);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller BEFORE any DB lookup (no owned-vs-orphan oracle)", async () => {
    // A participant / unauthenticated caller must be turned away by the role
    // pre-gate, so the route never runs the cv_url DB lookup and cannot be used
    // to distinguish a real CV file id (403) from an orphan id (404).
    mocks.getSession.mockResolvedValue({ user: { id: "p1" }, profile: { role: "participant" } });
    const dbSpy = vi.fn(() => makeDb({ [FILE_IN_CHAPTER_A]: CHAPTER_A }));
    mocks.createAdminClient.mockImplementation(dbSpy);

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(403);
    expect(dbSpy).not.toHaveBeenCalled();
    expect(mocks.requireChapterAdminApi).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller (no session) before any DB lookup", async () => {
    mocks.getSession.mockResolvedValue(null);
    const dbSpy = vi.fn(() => makeDb({ [FILE_IN_CHAPTER_A]: CHAPTER_A }));
    mocks.createAdminClient.mockImplementation(dbSpy);

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(403);
    expect(dbSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for a file id not owned by any application (no chapter to authorize against)", async () => {
    const res = await GET(
      new Request("http://t/"),
      paramsFor("orphan-file-id-zzzzzzzz")
    );

    // No owning application -> deny without ever consulting the guard or Drive,
    // so an attacker cannot pull an arbitrary Drive file by id.
    expect(res.status).toBe(404);
    expect(mocks.requireChapterAdminApi).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });
});
