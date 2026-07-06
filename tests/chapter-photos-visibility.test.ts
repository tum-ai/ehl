import { describe, it, expect, vi, beforeEach } from "vitest";

// Gallery photos are displayed via lh3.googleusercontent.com thumbnails, which
// only work for link-readable Drive files - but uploadFile() creates PRIVATE
// files. addChapterPhoto() must therefore grant link-readability BEFORE
// inserting the media row, and must refuse the insert (loud error, never a
// silently broken gallery) when the grant fails. This pins the regression that
// shipped the first real photo batch as 223 broken images.

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  createAdminClient: vi.fn(),
  ensureFileLinkReadable: vi.fn(),
  getFileMimeType: vi.fn(),
  logEvent: vi.fn(),
  getAdminUserId: vi.fn(),
}));

vi.mock("@/lib/admin-auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: mocks.getAdminUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/gdrive", () => ({
  ensureFileLinkReadable: mocks.ensureFileLinkReadable,
  getFileMimeType: mocks.getFileMimeType,
}));
vi.mock("@/lib/event-log", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logEvent: mocks.logEvent,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addChapterPhoto } from "@/lib/actions/admin";

function makeDb(inserts: unknown[], opts?: { cvFileIds?: string[] }) {
  return {
    from: (table: string) => {
      if (table === "applications") {
        let queried: string | null = null;
        const builder = {
          select: () => builder,
          eq: (_col: string, v: string) => {
            queried = v;
            return builder;
          },
          limit: () => builder,
          maybeSingle: () =>
            Promise.resolve({
              data: queried && (opts?.cvFileIds ?? []).includes(queried) ? { id: "app-1" } : null,
              error: null,
            }),
        };
        return builder;
      }
      return {
        insert: (payload: unknown) => {
          inserts.push(payload);
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: "m1" }, error: null }) }),
          };
        },
      };
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.ensureFileLinkReadable.mockResolvedValue(true);
  mocks.getFileMimeType.mockResolvedValue("image/jpeg");
});

describe("addChapterPhoto (thumbnail visibility)", () => {
  it("grants link-readability BEFORE inserting the media row", async () => {
    const inserts: unknown[] = [];
    mocks.createAdminClient.mockReturnValue(makeDb(inserts));

    const result = await addChapterPhoto("chapter-1", "drive-file-1");

    expect(mocks.ensureFileLinkReadable).toHaveBeenCalledWith("drive-file-1");
    expect(inserts).toHaveLength(1);
    expect(result).not.toHaveProperty("error");
  });

  it("refuses the insert with a loud error when the grant fails (no broken gallery tiles)", async () => {
    mocks.ensureFileLinkReadable.mockResolvedValue(false);
    const inserts: unknown[] = [];
    mocks.createAdminClient.mockReturnValue(makeDb(inserts));

    const result = await addChapterPhoto("chapter-1", "drive-file-1");

    expect(result).toHaveProperty("error");
    expect(inserts).toHaveLength(0);
  });

  it("refuses to publicize a file that is referenced as a CV (provenance guard)", async () => {
    const inserts: unknown[] = [];
    mocks.createAdminClient.mockReturnValue(makeDb(inserts, { cvFileIds: ["cv-file-1"] }));
    mocks.getFileMimeType.mockResolvedValue("image/jpeg");

    const result = await addChapterPhoto("chapter-1", "cv-file-1");

    expect(result).toHaveProperty("error");
    expect(mocks.ensureFileLinkReadable).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("refuses non-image files before any permission change", async () => {
    const inserts: unknown[] = [];
    mocks.createAdminClient.mockReturnValue(makeDb(inserts));
    mocks.getFileMimeType.mockResolvedValue("application/pdf");

    const result = await addChapterPhoto("chapter-1", "some-pdf");

    expect(result).toHaveProperty("error");
    expect(mocks.ensureFileLinkReadable).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("refuses when the mime type cannot be determined (fails closed)", async () => {
    const inserts: unknown[] = [];
    mocks.createAdminClient.mockReturnValue(makeDb(inserts));
    mocks.getFileMimeType.mockResolvedValue(null);

    const result = await addChapterPhoto("chapter-1", "unreadable");

    expect(result).toHaveProperty("error");
    expect(mocks.ensureFileLinkReadable).not.toHaveBeenCalled();
  });
});
