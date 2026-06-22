import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Call-site IDOR tests for chapter-scoped API routes.
//
// The guard functions are correct in isolation (tested in chapter-admin-guards.test.ts).
// These tests verify that the *routes themselves* enforce chapter scope on every DB
// query — i.e. that passing a valid guard for chapter A does not leak data from
// chapter B when a cross-chapter ID is supplied.

const mocks = vi.hoisted(() => ({
  requireChapterAdminApi: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireChapterAdminApi: mocks.requireChapterAdminApi,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET as getApplication } from "@/app/api/admin/chapters/[id]/applications/[applicationId]/route";
import { GET as getSubmissions } from "@/app/api/admin/chapters/[id]/submissions/route";

const CHAPTER_A = "chapter-a";
const CHAPTER_B = "chapter-b";
const APP_B = "app-from-chapter-b";
const CHALLENGE_B = "challenge-from-chapter-b";

function paramsFor(id: string, applicationId: string = "") {
  return { params: Promise.resolve({ id, applicationId }) };
}

function makeDb(rows: Record<string, unknown>) {
  // Returns a minimal chainable Supabase builder. Each call to single()/then()
  // resolves with the row stored under the last-used table key, or null.
  return {
    from(table: string) {
      const state: { filters: [string, unknown][] } = { filters: [] };
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => { state.filters.push([k, v]); return builder; },
        single: () => {
          // Find the row that satisfies ALL eq filters.
          const row = rows[table] ?? null;
          if (!row) return Promise.resolve({ data: null });
          const match = state.filters.every(([k, v]) => (row as Record<string, unknown>)[k] === v);
          return Promise.resolve({ data: match ? row : null });
        },
        in: (_k: string, _v: unknown) => builder,
        order: () => builder,
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: [] }).then(onF),
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Guard passes — simulates a chapter-A admin who is authorized for CHAPTER_A.
  mocks.requireChapterAdminApi.mockResolvedValue(null);
});

// ─── Single application route ────────────────────────────────────────────────

describe("GET /api/admin/chapters/[id]/applications/[applicationId]", () => {
  it("returns 404 when the applicationId belongs to a different chapter", async () => {
    // DB has the application, but it belongs to CHAPTER_B not CHAPTER_A.
    mocks.createAdminClient.mockReturnValue(
      makeDb({
        applications: { id: APP_B, chapter_id: CHAPTER_B, email: "victim@b.com" },
      })
    );

    const res = await getApplication(
      new Request("http://t/"),
      paramsFor(CHAPTER_A, APP_B)
    );

    // The route must not return chapter-B PII to a chapter-A admin.
    expect(res.status).toBe(404);
  });

  it("returns data when the applicationId belongs to the requested chapter", async () => {
    const app = {
      id: "app-a1",
      chapter_id: CHAPTER_A,
      email: "alice@a.com",
      first_name: "Alice",
      last_name: "A",
      status: "accepted",
      form_data: {},
      cv_url: null,
      existing_team_id: null,
      team_members: [],
      check_in_token: "tok",
      checked_in_at: null,
      checked_in_by: null,
      consent_attendance: true,
      consent_privacy: true,
      consent_newsletter: false,
      consent_recruiting: false,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      acceptance_email_sent_at: null,
      rejection_email_sent_at: null,
    };
    mocks.createAdminClient.mockReturnValue(makeDb({ applications: app }));

    const res = await getApplication(
      new Request("http://t/"),
      paramsFor(CHAPTER_A, "app-a1")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("alice@a.com");
  });
});

// ─── Submissions route — challengeId bypass ──────────────────────────────────

describe("GET /api/admin/chapters/[id]/submissions?challengeId=", () => {
  it("returns empty array when challengeId belongs to a different chapter", async () => {
    // The challenge exists but its chapter_id is CHAPTER_B, not CHAPTER_A.
    mocks.createAdminClient.mockReturnValue(
      makeDb({
        challenges: { id: CHALLENGE_B, chapter_id: CHAPTER_B },
      })
    );

    const url = `http://t/?challengeId=${CHALLENGE_B}`;
    const res = await getSubmissions(new Request(url), paramsFor(CHAPTER_A));

    // Must not expose submissions for a foreign challenge.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("queries submissions when challengeId belongs to the requested chapter", async () => {
    const CHALLENGE_A = "challenge-a1";
    // challenge belongs to CHAPTER_A — guard passes.
    const dbCalls: string[] = [];
    const client = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: () => {
            dbCalls.push(table);
            if (table === "challenges") {
              return Promise.resolve({ data: { id: CHALLENGE_A, chapter_id: CHAPTER_A } });
            }
            return Promise.resolve({ data: null });
          },
          in: () => builder,
          then: (onF: (v: unknown) => unknown) => {
            dbCalls.push(table);
            return Promise.resolve({ data: [] }).then(onF);
          },
        };
        return builder;
      },
    };
    mocks.createAdminClient.mockReturnValue(client);

    const url = `http://t/?challengeId=${CHALLENGE_A}`;
    const res = await getSubmissions(new Request(url), paramsFor(CHAPTER_A));

    expect(res.status).toBe(200);
    // The challenge ownership check must have run.
    expect(dbCalls).toContain("challenges");
  });
});
