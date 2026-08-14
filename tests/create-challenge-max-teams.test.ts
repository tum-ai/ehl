import { describe, it, expect, vi, beforeEach } from "vitest";

// createChallenge's optional max_teams field (first-come-first-served
// registration cap). Pins: valid values are written as a number, empty/absent
// is written as null (unlimited), and non-positive values are rejected before
// any DB write.
const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  logEvent: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminAction: mocks.requireAdminAction,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));

import { createChallenge } from "@/lib/actions/admin";

function makeAdminClient(insertSpy: ReturnType<typeof vi.fn>) {
  return {
    from: () => ({
      insert: (payload: unknown) => {
        insertSpy(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: "challenge-1" }, error: null }),
          }),
        };
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminAction.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-1");
});

describe("createChallenge max_teams", () => {
  it("writes max_teams as a number when provided", async () => {
    const insertSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(makeAdminClient(insertSpy));

    const fd = new FormData();
    fd.set("chapterId", "chapter-1");
    fd.set("title", "Test Challenge");
    fd.set("maxTeams", "5");

    const result = await createChallenge(fd);
    expect(result).toEqual({ success: true });
    expect(insertSpy.mock.calls[0][0].max_teams).toBe(5);
  });

  it("writes max_teams as null when left empty (unlimited)", async () => {
    const insertSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(makeAdminClient(insertSpy));

    const fd = new FormData();
    fd.set("chapterId", "chapter-1");
    fd.set("title", "Test Challenge");

    const result = await createChallenge(fd);
    expect(result).toEqual({ success: true });
    expect(insertSpy.mock.calls[0][0].max_teams).toBeNull();
  });

  it("rejects a non-positive max_teams before any DB write", async () => {
    const insertSpy = vi.fn();
    mocks.createAdminClient.mockReturnValue(makeAdminClient(insertSpy));

    const fd = new FormData();
    fd.set("chapterId", "chapter-1");
    fd.set("title", "Test Challenge");
    fd.set("maxTeams", "-1");

    const result = await createChallenge(fd);
    expect(result.error).toMatch(/positive whole number/i);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
