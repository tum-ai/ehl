import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The chapter detail stats panel renders on the chapter page that BOTH global
// and local (chapter) admins can open, so its API must be chapter-scoped — not
// global-admin only. A global-only guard here returns a 403 error body that the
// panel then crashes on (`apps.total` of undefined). These tests pin the route
// to the chapter-scoped guard and confirm it short-circuits when denied.
const mocks = vi.hoisted(() => ({
  requireChapterAdminApi: vi.fn(),
  getChapterDetailStats: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminApi: mocks.requireChapterAdminApi,
}));
vi.mock("@/lib/queries/admin-stats", () => ({
  getChapterDetailStats: mocks.getChapterDetailStats,
}));

import { GET } from "@/app/api/admin/chapters/[id]/stats/route";

const CHAPTER = "chapter-z";
const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/chapters/[id]/stats", () => {
  it("returns stats when the chapter-scoped guard passes (local admin allowed)", async () => {
    mocks.requireChapterAdminApi.mockResolvedValue(null);
    const stats = { applications: { total: 3 }, challenges: [], totals: {} };
    mocks.getChapterDetailStats.mockResolvedValue(stats);

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));

    // Guard is scoped to THIS chapter, not a global-admin check.
    expect(mocks.requireChapterAdminApi).toHaveBeenCalledWith(CHAPTER);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(stats);
  });

  it("short-circuits with the guard's response when access is denied", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    mocks.requireChapterAdminApi.mockResolvedValue(denied);

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));

    expect(res.status).toBe(403);
    // No data is computed or leaked once the guard denies.
    expect(mocks.getChapterDetailStats).not.toHaveBeenCalled();
  });
});
