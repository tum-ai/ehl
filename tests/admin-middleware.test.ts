import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The middleware is the coarse gate in front of every /admin page: only
// role "admin" gets through. The local (chapter) admin role was removed, but its
// 'chapter_admin' value still exists in the user_role enum (migration 00074
// keeps it), so a profile that somehow still carries it must be refused like
// any other non-admin, never confined to a chapter.

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as string | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({ data: mocks.role ? { role: mocks.role } : null }),
      };
      return builder;
    },
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";

function requestFor(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

function redirectPath(res: Response): string | null {
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

beforeEach(() => {
  mocks.user = { id: "user-1" };
  mocks.role = null;
});

describe("admin middleware gate", () => {
  it("lets an admin through to an admin chapter page", async () => {
    mocks.role = "admin";
    const res = await updateSession(requestFor("/admin/chapters/chapter-a"));
    expect(redirectPath(res)).toBeNull();
  });

  it("sends a leftover chapter_admin profile to the admin login, not to a chapter", async () => {
    mocks.role = "chapter_admin";
    const res = await updateSession(requestFor("/admin/chapters/chapter-a"));
    expect(redirectPath(res)).toBe("/admin/login");
  });

  it("refuses a participant on /admin", async () => {
    mocks.role = "participant";
    const res = await updateSession(requestFor("/admin"));
    expect(redirectPath(res)).toBe("/admin/login");
  });

  it("refuses an anonymous visitor on /admin", async () => {
    mocks.user = null;
    const res = await updateSession(requestFor("/admin/check-in"));
    expect(redirectPath(res)).toBe("/admin/login");
  });

  it("no longer bounces a chapter_admin profile from /dashboard into the admin panel", async () => {
    mocks.role = "chapter_admin";
    const res = await updateSession(requestFor("/dashboard"));
    expect(redirectPath(res)).toBeNull();
  });
});
