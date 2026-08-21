import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "github_token", GITHUB_ORG: "github_org" },
  getSettingValue: vi.fn(async (key: string, fallback?: string) => {
    if (key === "github_token") return "test-token";
    if (key === "github_org") return "snapshot-org";
    return fallback ?? null;
  }),
}));

import { fetchCheckpointBranchIntoFork } from "@/lib/github";

describe("fetchCheckpointBranchIntoFork", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies refs based Entire checkpoints into the snapshot fork", async () => {
    const checkpointRef = "refs/entire/checkpoints/WV/01M0JQB8SEQEVEZPP6R0G7VPWV";
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (url.includes("/git/matching-refs/entire/checkpoints")) {
          return new Response(JSON.stringify([{ ref: checkpointRef }]), { status: 200 });
        }
        if (url.includes("/git/ref/entire/checkpoints/WV/01M0JQB8SEQEVEZPP6R0G7VPWV")) {
          return new Response(JSON.stringify({ object: { sha: "checkpoint-sha" } }), { status: 200 });
        }
        if (url.endsWith("/git/refs")) {
          return new Response(JSON.stringify({ ref: checkpointRef }), { status: 201 });
        }
        return new Response("not found", { status: 404 });
      })
    );

    const result = await fetchCheckpointBranchIntoFork("owner", "repo", "snapshot");

    expect(result).toEqual({ ref: checkpointRef });
    const createCall = calls.find((call) => call.url.endsWith("/git/refs"));
    expect(createCall?.init?.method).toBe("POST");
    expect(JSON.parse(String(createCall?.init?.body))).toEqual({
      ref: checkpointRef,
      sha: "checkpoint-sha",
    });
  });
});
