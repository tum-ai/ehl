import { describe, it, expect, vi, beforeEach } from "vitest";

// The showcase hero used to count only consented applicants, so a chapter with
// 404 applications read "275 Applicants". The hero now states the chapter's real
// totals: every application (an exact head count, no consent filter) and every
// person on a team that submitted a project.

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getShowcaseApplicantTotal } from "@/lib/queries/showcase";
import { countSubmitters } from "@/lib/showcase-shared";

function makeCountDb(result: { count: number | null; error: Error | null }) {
  const calls = { eq: [] as string[], or: [] as string[], head: false };
  const builder = {
    select: (_cols: string, opts?: { head?: boolean }) => {
      calls.head = Boolean(opts?.head);
      return builder;
    },
    eq: (col: string, val: string) => {
      calls.eq.push(`${col}=${val}`);
      return builder;
    },
    or: (f: string) => {
      calls.or.push(f);
      return builder;
    },
    then(resolve: (v: typeof result) => void) {
      resolve(result);
    },
  };
  return { calls, client: { from: () => builder } };
}

beforeEach(() => vi.clearAllMocks());

describe("getShowcaseApplicantTotal", () => {
  it("counts every application of the chapter with no consent filter", async () => {
    const { client, calls } = makeCountDb({ count: 404, error: null });
    mocks.createAdminClient.mockReturnValue(client);

    expect(await getShowcaseApplicantTotal("chapter-a")).toBe(404);
    expect(calls.head).toBe(true);
    expect(calls.eq).toEqual(["chapter_id=chapter-a"]);
    expect(calls.or).toEqual([]);
  });

  it("throws when the count fails instead of showing 0", async () => {
    const { client } = makeCountDb({ count: null, error: new Error("boom") });
    mocks.createAdminClient.mockReturnValue(client);

    await expect(getShowcaseApplicantTotal("chapter-a")).rejects.toThrow("boom");
  });
});

describe("countSubmitters", () => {
  const registrations = [
    { teamId: "t1", challengeId: "c1", roster: ["u1", "u2", "u3"] },
    { teamId: "t2", challengeId: "c1", roster: ["u4", "u5"] },
    { teamId: "t3", challengeId: "c2", roster: ["u3", "u6"] },
  ];

  it("counts the members of teams that submitted, not those that did not", () => {
    expect(
      countSubmitters(registrations, [{ teamId: "t1", challengeId: "c1" }])
    ).toBe(3);
  });

  it("counts a person on two submitting registrations once", () => {
    expect(
      countSubmitters(registrations, [
        { teamId: "t1", challengeId: "c1" },
        { teamId: "t3", challengeId: "c2" },
      ])
    ).toBe(4);
  });

  it("ignores a submission for a challenge the team did not register for", () => {
    expect(
      countSubmitters(registrations, [{ teamId: "t2", challengeId: "c2" }])
    ).toBe(0);
  });
});
