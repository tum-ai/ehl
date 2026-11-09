import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The chapter detail stats panel renders on the admin chapter page. These tests
// pin the route to the admin guard and confirm it short-circuits when denied.
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getChapterDetailStats: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: mocks.requireAdmin,
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
  it("returns stats when the admin guard passes", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    const stats = { applications: { total: 3 }, challenges: [], totals: {} };
    mocks.getChapterDetailStats.mockResolvedValue(stats);

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));

    expect(mocks.requireAdmin).toHaveBeenCalledWith();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(stats);
  });

  it("short-circuits with the guard's response when access is denied", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    mocks.requireAdmin.mockResolvedValue(denied);

    const res = await GET(new Request("http://t/"), paramsFor(CHAPTER));

    expect(res.status).toBe(403);
    // No data is computed or leaked once the guard denies.
    expect(mocks.getChapterDetailStats).not.toHaveBeenCalled();
  });
});
