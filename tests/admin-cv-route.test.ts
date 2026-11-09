import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The CV proxy route (`/api/admin/cv/[fileId]`) streams an applicant's CV from
// Google Drive via the service account. Admins only, and only for a Drive file
// that is the CV of an application (applications.cv_url == fileId), so the route
// can never expose an arbitrary Drive file. The admin check runs BEFORE the DB
// lookup, so a non-admin cannot tell a real CV file id from an orphan one.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: mocks.requireAdmin,
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
const DENIED = () => NextResponse.json({ error: "Admin access required" }, { status: 403 });

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
            data: chapterId ? { id: "app-1", chapter_id: chapterId } : null,
          });
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default caller is an admin; individual tests override as needed.
  mocks.requireAdmin.mockResolvedValue(null);
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
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("serves an admin the CV of an application", async () => {
    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(mocks.downloadFile).toHaveBeenCalledWith(FILE_IN_CHAPTER_A);
  });

  it("rejects a non-admin caller BEFORE any DB lookup (no owned-vs-orphan oracle)", async () => {
    mocks.requireAdmin.mockResolvedValue(DENIED());
    const dbSpy = vi.fn(() => makeDb({ [FILE_IN_CHAPTER_A]: CHAPTER_A }));
    mocks.createAdminClient.mockImplementation(dbSpy);

    const res = await GET(new Request("http://t/"), paramsFor(FILE_IN_CHAPTER_A));

    expect(res.status).toBe(403);
    expect(dbSpy).not.toHaveBeenCalled();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("returns 404 to an admin for a file id not owned by any application", async () => {
    const res = await GET(
      new Request("http://t/"),
      paramsFor("orphan-file-id-zzzzzzzz")
    );

    // No owning application -> never fetched from Drive, so an arbitrary Drive
    // file cannot be pulled by id.
    expect(res.status).toBe(404);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });
});
