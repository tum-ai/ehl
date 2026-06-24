import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// The queue route MUST surface the GitHub dispatch outcome to the admin instead
// of swallowing it (a swallowed failure leaves reviews "Queued" forever with no
// worker). These tests pin: (1) auth guard short-circuits, (2) the dispatch result
// is returned in the JSON, both for success and failure.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  dispatchCodeReviewWorker: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/code-review/dispatch", () => ({
  dispatchCodeReviewWorker: mocks.dispatchCodeReviewWorker,
}));

import { POST } from "@/app/api/admin/code-reviews/queue/route";

// Minimal admin client: count probe (queue depth) + upsert.
function fakeAdminClient() {
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ count: 0 }),
      }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  };
}

function req(body: unknown) {
  return new Request("http://t/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue(fakeAdminClient());
});

describe("POST /api/admin/code-reviews/queue", () => {
  it("short-circuits when the admin guard denies", async () => {
    mocks.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await POST(req({ submissionIds: ["s1"] }));

    expect(res.status).toBe(403);
    // Never touched the DB or dispatched once denied.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.dispatchCodeReviewWorker).not.toHaveBeenCalled();
  });

  it("returns the dispatch SUCCESS result (not swallowed)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    mocks.dispatchCodeReviewWorker.mockResolvedValue({
      attempted: true,
      ok: true,
      status: 204,
    });

    const res = await POST(req({ submissionIds: ["s1", "s2"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.queued).toBe(2);
    expect(json.dispatch).toEqual({ attempted: true, ok: true, status: 204 });
  });

  it("returns the dispatch FAILURE result so the admin sees it", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    mocks.dispatchCodeReviewWorker.mockResolvedValue({
      attempted: true,
      ok: false,
      reason: "http_error",
      status: 404,
      message: "GitHub dispatch failed (HTTP 404)",
    });

    const res = await POST(req({ submissionIds: ["s1"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.dispatch.ok).toBe(false);
    expect(json.dispatch.status).toBe(404);
    expect(json.dispatch.message).toContain("404");
  });

  it("does not dispatch when caller opts out (dispatch:false)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);

    const res = await POST(req({ submissionIds: ["s1"], dispatch: false }));
    const json = await res.json();

    expect(mocks.dispatchCodeReviewWorker).not.toHaveBeenCalled();
    expect(json.dispatch).toBeNull();
  });

  it("rejects an empty submissionIds list", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    const res = await POST(req({ submissionIds: [] }));
    expect(res.status).toBe(400);
  });
});
