import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase admin client before importing the module under test
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = vi.fn<any>();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

import { getCheckinStatusForUsers } from "@/lib/queries/checkin";

// ─── Helper to set up chained query mocks ─────────────────

function setupChain(returnData: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData }),
  };
  // Make select/eq/in return the same chain
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  return chain;
}

// ─── getCheckinStatusForUsers ─────────────────────────────

describe("getCheckinStatusForUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map for empty userIds", async () => {
    const result = await getCheckinStatusForUsers([], "chapter-1");
    expect(result.size).toBe(0);
  });

  it("returns correct check-in status for multiple users", async () => {
    const profilesChain = setupChain(null);
    profilesChain.in.mockResolvedValue({
      data: [
        { id: "user-1", email: "alice@example.com" },
        { id: "user-2", email: "bob@example.com" },
        { id: "user-3", email: "charlie@example.com" },
      ],
    });

    const applicationsChain = setupChain(null);
    applicationsChain.in.mockResolvedValue({
      data: [
        { email: "alice@example.com", status: "checked_in" },
        { email: "bob@example.com", status: "accepted" },
        // charlie has no application at all
      ],
    });

    let callCount = 0;
    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "profiles") {
        callCount++;
        return profilesChain;
      }
      if (table === "applications") {
        return applicationsChain;
      }
      return setupChain(null);
    });

    const result = await getCheckinStatusForUsers(
      ["user-1", "user-2", "user-3"],
      "chapter-1"
    );

    expect(result.get("user-1")).toBe(true); // checked_in
    expect(result.get("user-2")).toBe(false); // accepted but not checked_in
    expect(result.get("user-3")).toBe(false); // no application
  });

  it("marks all users as false when no profiles found", async () => {
    const profilesChain = setupChain(null);
    profilesChain.in.mockResolvedValue({ data: [] });

    mockFrom.mockImplementation(() => profilesChain);

    const result = await getCheckinStatusForUsers(
      ["user-1", "user-2"],
      "chapter-1"
    );

    expect(result.get("user-1")).toBe(false);
    expect(result.get("user-2")).toBe(false);
  });

  it("marks user as false when profile exists but no application", async () => {
    const profilesChain = setupChain(null);
    profilesChain.in.mockResolvedValue({
      data: [{ id: "user-1", email: "alice@example.com" }],
    });

    const applicationsChain = setupChain(null);
    applicationsChain.in.mockResolvedValue({ data: [] });

    (mockFrom as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "profiles") return profilesChain;
      if (table === "applications") return applicationsChain;
      return setupChain(null);
    });

    const result = await getCheckinStatusForUsers(["user-1"], "chapter-1");
    expect(result.get("user-1")).toBe(false);
  });

  it("handles null data gracefully", async () => {
    const profilesChain = setupChain(null);
    profilesChain.in.mockResolvedValue({ data: null });

    mockFrom.mockImplementation(() => profilesChain);

    const result = await getCheckinStatusForUsers(["user-1"], "chapter-1");
    expect(result.get("user-1")).toBe(false);
  });
});
