import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createServerClient,
}));

import { getUpcomingEventRecruiting } from "@/lib/queries/teams";

function serverClientReturning(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUpcomingEventRecruiting", () => {
  it("maps the upcoming event and its eligible team ids", async () => {
    mocks.createServerClient.mockResolvedValue(
      serverClientReturning({
        data: [
          {
            chapter_id: "chapter-1",
            chapter_name: "Munich 2",
            chapter_slug: "munich-2",
            chapter_city: "Munich",
            chapter_date: "2026-08-22",
            chapter_date_end: "2026-08-24",
            team_id: "team-1",
          },
          {
            chapter_id: "chapter-1",
            chapter_name: "Munich 2",
            chapter_slug: "munich-2",
            chapter_city: "Munich",
            chapter_date: "2026-08-22",
            chapter_date_end: "2026-08-24",
            team_id: "team-2",
          },
        ],
        error: null,
      })
    );

    await expect(getUpcomingEventRecruiting()).resolves.toEqual({
      chapter: {
        id: "chapter-1",
        name: "Munich 2",
        slug: "munich-2",
        city: "Munich",
        date: "2026-08-22",
        dateEnd: "2026-08-24",
      },
      teamIds: ["team-1", "team-2"],
    });
  });

  it("keeps the upcoming event context when no president is eligible", async () => {
    mocks.createServerClient.mockResolvedValue(
      serverClientReturning({
        data: [
          {
            chapter_id: "chapter-1",
            chapter_name: "Munich 2",
            chapter_slug: "munich-2",
            chapter_city: "Munich",
            chapter_date: "2026-08-22",
            chapter_date_end: null,
            team_id: null,
          },
        ],
        error: null,
      })
    );

    const result = await getUpcomingEventRecruiting();

    expect(result?.teamIds).toEqual([]);
    expect(result?.chapter.dateEnd).toBeNull();
  });

  it("throws instead of presenting an empty section when the database check fails", async () => {
    mocks.createServerClient.mockResolvedValue(
      serverClientReturning({ data: null, error: new Error("database unavailable") })
    );

    await expect(getUpcomingEventRecruiting()).rejects.toThrow("database unavailable");
  });
});
