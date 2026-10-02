import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "token", GITHUB_ORG: "org" },
  getSettingValue: async (key: string) =>
    key === "token" ? "test-token" : "test-org",
}));
import {
  acceptPendingInvite,
  snapshotRepo,
  fetchCheckpointBranchIntoFork,
} from "@/lib/github";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub reliability regressions", () => {
  it("finds an invitation beyond the first page", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("page=2"))
        return Response.json([
          { id: 151, repository: { full_name: "owner/repo" } },
        ]);
      if (url.endsWith("/151")) return new Response(null, { status: 204 });
      return Response.json([], {
        headers: {
          link: '<https://api.github.com/user/repository_invitations?per_page=100&page=2>; rel="next"',
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await acceptPendingInvite("owner", "repo")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not report a stale fork as synchronized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("merge-upstream")
          ? Response.json({ message: "rate limit" }, { status: 403 })
          : Response.json({ default_branch: "main" }),
      ),
    );
    expect(await snapshotRepo("owner", "repo", "copy", "test")).toHaveProperty(
      "error",
    );
  });

  it("uses listed SHAs and leaves identical checkpoint refs untouched", async () => {
    const ref = "refs/entire/checkpoints/aa/checkpoint";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("matching-refs"))
          return Response.json([{ ref, object: { sha: "a".repeat(40) } }]);
        return new Response(null, { status: 404 });
      }),
    );
    expect(
      await fetchCheckpointBranchIntoFork("owner", "repo", "copy"),
    ).toEqual({ ref });
    expect(calls.filter((url) => url.endsWith("/git/refs"))).toEqual([]);
    expect(
      calls.filter((url) => url.includes("/git/ref/entire/checkpoints/aa")),
    ).toEqual([]);
  });
});
