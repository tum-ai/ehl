import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The registrations endpoint powers the manual-results flow on the admin scores
// page (roster of chapter-registered teams + their challenge). It must be
// global-admin only (like every other scores API) and return the mapped shape.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "@/app/api/admin/chapters/[id]/registrations/route";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeDb(result: { data?: unknown; error?: { message: string } | null }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { from: vi.fn(() => builder) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(null);
});

describe("GET /api/admin/chapters/[id]/registrations", () => {
  it("rejects non-admins before any DB work", async () => {
    mocks.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );
    const db = makeDb({ data: [] });
    mocks.createAdminClient.mockReturnValue(db);

    const res = await GET(new Request("http://t/"), paramsFor("c1"));

    expect(res.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns the chapter's registrations as {teamId, challengeId}", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({
        data: [
          { team_id: "t1", challenge_id: "ch1" },
          { team_id: "t2", challenge_id: null },
        ],
      })
    );

    const res = await GET(new Request("http://t/"), paramsFor("c1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { teamId: "t1", challengeId: "ch1" },
      { teamId: "t2", challengeId: null },
    ]);
  });

  it("surfaces a DB error as 500 (admin must never act on silently empty data)", async () => {
    mocks.createAdminClient.mockReturnValue(makeDb({ error: { message: "boom" } }));

    const res = await GET(new Request("http://t/"), paramsFor("c1"));

    expect(res.status).toBe(500);
  });
});
