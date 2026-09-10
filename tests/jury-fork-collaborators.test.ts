import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "github_token", GITHUB_ORG: "github_org" },
  getSettingValue: vi.fn(async (key: string, fallback?: string) => {
    if (key === "github_token") return "test-token";
    if (key === "github_org") return "snapshot-org";
    return fallback ?? null;
  }),
}));

import { addCollaborators } from "@/lib/github";

type Call = { url: string; init?: RequestInit };

/** Stub GitHub, recording calls. `collabStatus` drives the PUT response. */
function stubGitHub(opts: {
  searchResult?: string | null;
  collabStatus?: number;
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.includes("/search/users")) {
        const items = opts.searchResult ? [{ login: opts.searchResult }] : [];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      if (url.includes("/collaborators/")) {
        return new Response(null, { status: opts.collabStatus ?? 201 });
      }
      return new Response("not found", { status: 404 });
    })
  );
  return calls;
}

describe("addCollaborators", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invites using the stored username and never calls the email search", async () => {
    const calls = stubGitHub({});

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "jury@sponsor.com", githubUsername: "octocat" },
    ]);

    expect(results).toEqual([
      {
        email: "jury@sponsor.com",
        username: "octocat",
        resolvedBy: "username",
        invited: true,
      },
    ]);
    // The whole point of storing the username: no unreliable lookup.
    expect(calls.some((c) => c.url.includes("/search/users"))).toBe(false);

    const put = calls.find((c) => c.url.includes("/collaborators/"));
    expect(put?.url).toBe(
      "https://api.github.com/repos/snapshot-org/fork/collaborators/octocat"
    );
    expect(put?.init?.method).toBe("PUT");
    // Read access only: jury must never be able to push to a snapshot.
    expect(JSON.parse(String(put?.init?.body))).toEqual({ permission: "read" });
  });

  it("treats 204 (already a collaborator) as invited, not a failure", async () => {
    stubGitHub({ collabStatus: 204 });

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "jury@sponsor.com", githubUsername: "octocat" },
    ]);

    expect(results[0].invited).toBe(true);
  });

  it("falls back to email search for a juror invited before usernames existed", async () => {
    const calls = stubGitHub({ searchResult: "legacy-juror" });

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "legacy@sponsor.com", githubUsername: null },
    ]);

    expect(results[0]).toMatchObject({
      username: "legacy-juror",
      resolvedBy: "email_search",
      invited: true,
    });
    expect(calls.some((c) => c.url.includes("/search/users"))).toBe(true);
  });

  it("reports a failure instead of silently skipping when nothing resolves", async () => {
    // The original bug: a juror whose GitHub email is private matched nothing,
    // the loop `continue`d, and the jury simply never got access.
    stubGitHub({ searchResult: null });

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "private@sponsor.com" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].invited).toBe(false);
    expect(results[0].username).toBeNull();
    expect(results[0].error).toContain("GitHub username");
  });

  it("reports a failure when GitHub rejects the username", async () => {
    stubGitHub({ collabStatus: 404 });

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "jury@sponsor.com", githubUsername: "no-such-user" },
    ]);

    expect(results[0].invited).toBe(false);
    expect(results[0].error).toContain("404");
  });

  it("keeps inviting the rest after one juror fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/search/users")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.includes("/collaborators/broken")) {
          return new Response(null, { status: 422 });
        }
        if (url.includes("/collaborators/")) {
          return new Response(null, { status: 201 });
        }
        return new Response("not found", { status: 404 });
      })
    );

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "a@sponsor.com", githubUsername: "broken" },
      { email: "b@sponsor.com" },
      { email: "c@sponsor.com", githubUsername: "fine" },
    ]);

    expect(results.map((r) => r.invited)).toEqual([false, false, true]);
    // Every juror is accounted for, so an admin can chase the two that failed.
    expect(results.map((r) => r.email)).toEqual([
      "a@sponsor.com",
      "b@sponsor.com",
      "c@sponsor.com",
    ]);
  });

  it("reports every juror as failed when no GitHub token is configured", async () => {
    const settings = await import("@/lib/settings");
    vi.mocked(settings.getSettingValue).mockResolvedValueOnce(null);

    const results = await addCollaborators("snapshot-org", "fork", [
      { email: "jury@sponsor.com", githubUsername: "octocat" },
    ]);

    expect(results[0].invited).toBe(false);
    expect(results[0].error).toContain("token");
  });
});
