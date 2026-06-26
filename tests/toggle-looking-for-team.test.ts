import { describe, it, expect, vi, beforeEach } from "vitest";

// toggleLookingForTeam updates profiles.looking_for_team for the signed-in user.
// It must CONFIRM a row was actually updated (it previously returned success even
// on a 0-row update, so the toggle silently "didn't stick" for a profileless user).
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createServerClient }));
// teams.ts imports other things at module load; stub the ones with side effects.
vi.mock("@/lib/email-deferred", () => ({ sendEmailAfterResponse: vi.fn() }));
vi.mock("@/lib/event-log", () => ({ logEvent: vi.fn() }));

import { toggleLookingForTeam } from "@/lib/actions/teams";

const USER = { id: "user-1" };

/** A minimal admin client whose profiles.update().eq().select().maybeSingle()
 *  resolves to the given { data, error }. */
function adminClientReturning(result: { data: unknown; error: unknown }) {
  const builder = {
    update: () => builder,
    eq: () => builder,
    select: () => builder,
    maybeSingle: () => Promise.resolve(result),
  };
  return { from: () => builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER } }) },
  });
});

describe("toggleLookingForTeam", () => {
  it("rejects an unauthenticated caller", async () => {
    mocks.createServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const result = await toggleLookingForTeam(true);
    expect(result).toEqual({ error: "Not authenticated." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("succeeds when the update changes exactly one row", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminClientReturning({ data: { id: USER.id }, error: null })
    );
    const result = await toggleLookingForTeam(true);
    expect(result).toEqual({ success: true });
  });

  it("returns an error (not silent success) when NO row was updated (missing profile)", async () => {
    // The exact bug: a profileless user's update matches 0 rows. It must surface
    // an error instead of pretending the toggle stuck.
    mocks.createAdminClient.mockReturnValue(
      adminClientReturning({ data: null, error: null })
    );
    const result = await toggleLookingForTeam(true);
    expect("error" in result).toBe(true);
    expect("success" in result).toBe(false);
    expect((result as { error: string }).error).toMatch(/profile could not be found/i);
  });

  it("returns an error when the update itself fails", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminClientReturning({ data: null, error: { message: "db down" } })
    );
    const result = await toggleLookingForTeam(false);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/could not update/i);
  });
});
