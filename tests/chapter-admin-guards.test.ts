import { describe, it, expect, vi, beforeEach } from "vitest";

// These guards are the authorization boundary for local (chapter) admins, so we
// pin every branch: global admins pass everywhere, a local admin passes only for
// its own chapter, and everyone else is rejected. getSession and
// getAdminChapterId are mocked so we test the guard logic in isolation.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAdminChapterId: vi.fn(),
  redirect: vi.fn(() => {
    // Mirror Next's real redirect(), which throws to halt rendering.
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/chapter-admin", () => ({
  getAdminChapterId: mocks.getAdminChapterId,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  requireGlobalAdminPage,
  requireChapterAdminPage,
  requireChapterAdminAction,
  requireChapterAdminApi,
} from "@/lib/admin-auth";

const CHAPTER = "chapter-a";
const OTHER = "chapter-b";

function sessionWith(role: string, userId = "user-1") {
  return { user: { id: userId }, profile: { role } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireGlobalAdminPage", () => {
  it("passes a global admin", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("admin"));
    await expect(requireGlobalAdminPage()).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects a local admin to their own chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    await expect(requireGlobalAdminPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(`/admin/chapters/${CHAPTER}`);
  });

  it("sends a participant to the admin login", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("participant"));
    await expect(requireGlobalAdminPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login");
  });
});

describe("requireChapterAdminPage", () => {
  it("passes a global admin for any chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("admin"));
    await expect(requireChapterAdminPage(CHAPTER)).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("passes a local admin for their own chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    await expect(requireChapterAdminPage(CHAPTER)).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects a local admin away from another chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    await expect(requireChapterAdminPage(OTHER)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(`/admin/chapters/${CHAPTER}`);
  });

  it("sends a participant to the admin login", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("participant"));
    await expect(requireChapterAdminPage(CHAPTER)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login");
  });
});

describe("requireChapterAdminAction", () => {
  it("allows a global admin", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("admin"));
    expect(await requireChapterAdminAction(CHAPTER)).toBeNull();
  });

  it("allows a local admin for their own chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    expect(await requireChapterAdminAction(CHAPTER)).toBeNull();
  });

  it("rejects a local admin for another chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    expect(await requireChapterAdminAction(OTHER)).toBe("Admin access required.");
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(await requireChapterAdminAction(CHAPTER)).toBe("Admin access required.");
  });
});

describe("requireChapterAdminApi", () => {
  it("allows a global admin (returns null)", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("admin"));
    expect(await requireChapterAdminApi(CHAPTER)).toBeNull();
  });

  it("403s a local admin for another chapter", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    const res = await requireChapterAdminApi(OTHER);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("allows a local admin for their own chapter (returns null)", async () => {
    mocks.getSession.mockResolvedValue(sessionWith("chapter_admin"));
    mocks.getAdminChapterId.mockResolvedValue(CHAPTER);
    expect(await requireChapterAdminApi(CHAPTER)).toBeNull();
  });
});
