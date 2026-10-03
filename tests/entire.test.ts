import { describe, it, expect, vi, afterEach } from "vitest";

// The GitHub token comes from getSettingValue, which constructs a Supabase admin
// client. Stub it so checkCheckpointBranch's network path is exercised in
// isolation without needing DB env vars. We test the token plumbing elsewhere.
vi.mock("@/lib/settings", () => ({
  SETTING_KEYS: { GITHUB_TOKEN: "github_token" },
  getSettingValue: vi.fn().mockResolvedValue("test-token"),
}));

import {
  countPromptsInPromptTxt,
  promptCountFromMetadata,
  countCheckpointDirs,
  extractCheckpointTrailer,
  isPromptFilePath,
  isTranscriptFilePath,
  checkCheckpointBranch,
  entireGateErrorMessage,
  listEntireCheckpointRefs,
  ENTIRE_BRANCH,
  MAX_ENTIRE_CHECKPOINT_REFS,
  isEntireCheckpointRef,
  ingestSessionHistory,
} from "@/lib/entire";
import type { CheckpointBranchCheck } from "@/lib/types";
import { getSettingValue } from "@/lib/settings";

// ─── Pure helpers ─────────────────────────────────────────────

describe("countPromptsInPromptTxt", () => {
  it("returns 0 for empty/whitespace content", () => {
    expect(countPromptsInPromptTxt("")).toBe(0);
    expect(countPromptsInPromptTxt("   \n  ")).toBe(0);
  });

  it("counts a single prompt with no separators as 1", () => {
    expect(countPromptsInPromptTxt("build me a todo app")).toBe(1);
  });

  it("counts prompts split by the canonical separator", () => {
    const content = "first prompt\n\n---\n\nsecond prompt\n\n---\n\nthird";
    expect(countPromptsInPromptTxt(content)).toBe(3);
  });

  it("ignores empty trailing segments (Entire trims these)", () => {
    const content = "only real prompt\n\n---\n\n";
    expect(countPromptsInPromptTxt(content)).toBe(1);
  });
});

describe("promptCountFromMetadata", () => {
  it("returns 0 for non-objects", () => {
    expect(promptCountFromMetadata(null)).toBe(0);
    expect(promptCountFromMetadata("nope")).toBe(0);
    expect(promptCountFromMetadata(42)).toBe(0);
  });

  it("counts a prompts array (newer format)", () => {
    expect(promptCountFromMetadata({ prompts: ["a", "b", "  ", "c"] })).toBe(3);
  });

  it("reads checkpoints_count / prompt_count style fields", () => {
    expect(promptCountFromMetadata({ checkpoints_count: 4 })).toBe(4);
    expect(promptCountFromMetadata({ promptCount: 2 })).toBe(2);
  });

  it("falls back to the sessions map size (CheckpointSummary)", () => {
    expect(promptCountFromMetadata({ sessions: { "0": {}, "1": {} } })).toBe(2);
  });

  it("returns 0 for unknown shapes without throwing", () => {
    expect(promptCountFromMetadata({ something: "else" })).toBe(0);
  });
});

describe("countCheckpointDirs", () => {
  it("counts distinct sharded checkpoint directories", () => {
    const paths = [
      "a3/b2c4d5e6f7/metadata.json",
      "a3/b2c4d5e6f7/0/prompt.txt",
      "a3/b2c4d5e6f7/0/full.jsonl",
      "ff/0011223344/metadata.json",
      "README.md",
    ];
    expect(countCheckpointDirs(paths)).toBe(2);
  });

  it("ignores non-sharded paths", () => {
    expect(countCheckpointDirs(["docs/x.md", "src/index.ts"])).toBe(0);
  });
});

describe("entireGateErrorMessage", () => {
  const base: CheckpointBranchCheck = {
    branchExists: false,
    promptCount: 0,
    checkpointCount: 0,
    resolvedRef: null,
    repoUnreadable: false,
    checkUnavailable: false,
    satisfiesGate: false,
    notes: [],
  };

  it("gives a 'no branch' message when the branch is absent", () => {
    const msg = entireGateErrorMessage({ ...base, branchExists: false });
    expect(msg).toMatch(/recognized Entire checkpoint branch or ref/i);
    expect(msg).toMatch(/entire enable/);
  });

  it("gives a 'no prompts' message when the branch exists but is empty", () => {
    const msg = entireGateErrorMessage({ ...base, branchExists: true });
    expect(msg).toMatch(/could not find any captured prompts/i);
  });

  // An unreadable repo used to be reported as "you have no checkpoint branch",
  // which sent teams off to redo work they had already done correctly.
  it("gives an access message, not a 'no branch' message, when the repo is unreadable", () => {
    const msg = entireGateErrorMessage({ ...base, repoUnreadable: true });
    expect(msg).toMatch(/could not read your repository/i);
    expect(msg).toMatch(/ehl-gg/);
    expect(msg).not.toMatch(/entire enable/);
    expect(msg).not.toMatch(/recognized Entire checkpoint branch or ref/i);
  });

  // repoUnreadable must win even when the other fields look like the ordinary
  // "no branch" case, which is exactly the shape checkCheckpointBranch returns.
  it("prefers the access message over the branch message", () => {
    const msg = entireGateErrorMessage({
      ...base,
      branchExists: false,
      repoUnreadable: true,
    });
    expect(msg).toMatch(/could not read your repository/i);
  });
});

describe("extractCheckpointTrailer", () => {
  it("extracts the 12-hex checkpoint id from a commit trailer", () => {
    const msg = "Add feature\n\nEntire-Checkpoint: a3b2c4d5e6f7\n";
    expect(extractCheckpointTrailer(msg)).toBe("a3b2c4d5e6f7");
  });

  it("returns null when no trailer present", () => {
    expect(extractCheckpointTrailer("just a normal commit")).toBeNull();
  });
});

describe("path classifiers", () => {
  it("recognizes prompt files in session subdirs", () => {
    expect(isPromptFilePath("a3/b2c4d5e6f7/0/prompt.txt")).toBe(true);
    expect(isPromptFilePath("prompt.txt")).toBe(true);
    expect(isPromptFilePath("metadata.json")).toBe(false);
  });

  it("recognizes current and legacy transcript files", () => {
    expect(isTranscriptFilePath("a3/x/0/full.jsonl")).toBe(true);
    expect(isTranscriptFilePath("a3/x/0/full.log")).toBe(true); // legacy
    expect(isTranscriptFilePath("a3/x/0/prompt.txt")).toBe(false);
  });
});

// ─── checkCheckpointBranch (mocked GitHub) ────────────────────

type FetchMock = ReturnType<typeof vi.fn>;

/** Build a fetch mock from a URL->response map. */
function mockFetch(handler: (url: string) => { status?: number; json?: unknown }): FetchMock {
  return vi.fn(async (url: string) => {
    const { status = 200, json } = handler(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(json),
    };
  }) as unknown as FetchMock;
}

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

describe("checkCheckpointBranch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  // The repo endpoint (no path suffix) is the access probe; every other URL is
  // ref/tree/blob traffic. Keeping them apart is what lets us tell "this repo
  // has no Entire record" from "we were never allowed to look".
  const isRepoProbe = (url: string) => /\/repos\/[^/]+\/[^/]+$/.test(url);

  it("reports no branch when the repo is readable but all candidate refs 404", async () => {
    globalThis.fetch = mockFetch((url) =>
      isRepoProbe(url) ? { json: { private: false } } : { status: 404 }
    );
    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(false);
    expect(r.satisfiesGate).toBe(false);
    expect(r.resolvedRef).toBeNull();
    expect(r.repoUnreadable).toBe(false);
    expect(entireGateErrorMessage(r)).toMatch(/entire enable/);
  });

  // Munich-2: a private repo without ehl-gg access 404s exactly like a repo with
  // no checkpoint data, and teams were told to redo work they had already done.
  it("reports repoUnreadable when the repo itself is not accessible", async () => {
    globalThis.fetch = mockFetch(() => ({ status: 404 }));
    const r = await checkCheckpointBranch("o", "r");
    expect(r.repoUnreadable).toBe(true);
    expect(r.branchExists).toBe(false);
    expect(r.satisfiesGate).toBe(false);
    expect(entireGateErrorMessage(r)).toMatch(/could not read your repository/i);
  });

  // 401/403 mean OUR credentials were refused, so this is not the team's repo
  // being unreadable: it is our check failing to run. Reporting it as
  // repoUnreadable told the team to invite ehl-gg to fix a problem on our side.
  // (The 500 case below has always been treated this way; these two now match.)
  it.each([401, 403])("treats HTTP %i as OUR failure, not the team's", async (status) => {
    globalThis.fetch = mockFetch((url) => (isRepoProbe(url) ? { status } : { status: 404 }));
    const r = await checkCheckpointBranch("o", "r");
    expect(r.checkUnavailable).toBe(true);
    expect(r.repoUnreadable).toBe(false);
    expect(r.satisfiesGate).toBe(false);
    expect(entireGateErrorMessage(r)).toMatch(/on us, not on you/i);
    expect(entireGateErrorMessage(r)).not.toMatch(/ehl-gg/);
  });

  // 404 stays the team's to fix: GitHub answers 404 (not 403) for a private repo
  // we have no access to, so it is the shape of "invite ehl-gg" or "wrong URL".
  it("keeps HTTP 404 as the team's to fix", async () => {
    globalThis.fetch = mockFetch(() => ({ status: 404 }));
    const r = await checkCheckpointBranch("o", "r");
    expect(r.repoUnreadable).toBe(true);
    expect(r.checkUnavailable).toBe(false);
  });

  // A rate limit or a blip must never be turned into "your repo is private".
  it("does not claim unreadable when the probe fails transiently", async () => {
    globalThis.fetch = mockFetch((url) =>
      isRepoProbe(url) ? { status: 500 } : { status: 404 }
    );
    const r = await checkCheckpointBranch("o", "r");
    expect(r.repoUnreadable).toBe(false);
  });

  it("passes the gate on a clean Claude-style checkpoint with prompt.txt", async () => {
    const tree = {
      tree: [
        { path: "a3/b2c4d5e6f7/metadata.json", type: "blob" },
        { path: "a3/b2c4d5e6f7/0/prompt.txt", type: "blob" },
        { path: "a3/b2c4d5e6f7/0/full.jsonl", type: "blob" },
      ],
    };
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/trees/")) {
        if (url.includes(encodeURIComponent(ENTIRE_BRANCH))) return { json: tree };
        return { status: 404 };
      }
      if (url.includes("prompt.txt")) {
        return { json: { encoding: "base64", content: b64("p1\n\n---\n\np2") } };
      }
      return { status: 404 };
    });
    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(true);
    expect(r.promptCount).toBe(2);
    expect(r.checkpointCount).toBe(1);
    expect(r.satisfiesGate).toBe(true);
  });

  it("SOFT: passes a Codex-style checkpoint with no usable prompt.txt via metadata fallback", async () => {
    const tree = {
      tree: [
        { path: "ff/0011223344/metadata.json", type: "blob" },
        { path: "ff/0011223344/0/metadata.json", type: "blob" },
        // note: no prompt.txt at all
      ],
    };
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/trees/")) {
        if (url.includes(encodeURIComponent(ENTIRE_BRANCH))) return { json: tree };
        return { status: 404 };
      }
      if (url.includes("0/metadata.json")) {
        return { json: { encoding: "base64", content: b64(JSON.stringify({ checkpoints_count: 3 })) } };
      }
      if (url.includes("metadata.json")) {
        return { json: { encoding: "base64", content: b64(JSON.stringify({ sessions: { "0": {} } })) } };
      }
      return { status: 404 };
    });
    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(true);
    expect(r.promptCount).toBeGreaterThanOrEqual(1);
    expect(r.satisfiesGate).toBe(true);
    expect(r.notes.join(" ")).toMatch(/metadata fallback/);
  });

  it("SOFT: accepts a transcript-only checkpoint (malformed everything else) as 1", async () => {
    const tree = {
      tree: [
        { path: "ab/cdef012345/0/full.log", type: "blob" }, // legacy transcript, no prompt/meta
      ],
    };
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/trees/")) {
        if (url.includes(encodeURIComponent(ENTIRE_BRANCH))) return { json: tree };
        return { status: 404 };
      }
      return { status: 404 };
    });
    const r = await checkCheckpointBranch("o", "r");
    expect(r.satisfiesGate).toBe(true);
    expect(r.promptCount).toBe(1);
    expect(r.notes.join(" ")).toMatch(/transcript is present/);
  });

  it("SOFT: resolves via the v1.1 mirror ref when v1 branch is absent", async () => {
    const tree = { tree: [{ path: "a3/b2c4d5e6f7/0/prompt.txt", type: "blob" }] };
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/trees/")) {
        // v1 branch 404s; the v1.1 mirror resolves
        if (url.includes(encodeURIComponent("refs/entire/checkpoints/v1.1"))) return { json: tree };
        return { status: 404 };
      }
      if (url.includes("prompt.txt")) {
        return { json: { encoding: "base64", content: b64("one prompt") } };
      }
      return { status: 404 };
    });
    const r = await checkCheckpointBranch("o", "r");
    expect(r.satisfiesGate).toBe(true);
    expect(r.resolvedRef).toBe("refs/entire/checkpoints/v1.1");
  });

  it("SOFT: resolves via a ref based checkpoint", async () => {
    const checkpointRef = "refs/entire/checkpoints/WV/01M0JQB8SEQEVEZPP6R0G7VPWV";
    const tree = { tree: [{ path: "0/prompt.txt", type: "blob" }] };
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/trees/")) {
        if (url.includes(encodeURIComponent(checkpointRef))) return { json: tree };
        return { status: 404 };
      }
      if (url.includes("/git/matching-refs/entire/checkpoints")) {
        return { json: [{ ref: checkpointRef, object: { sha: "sha" } }] };
      }
      if (url.includes("prompt.txt")) {
        return { json: { encoding: "base64", content: b64("one prompt") } };
      }
      return { status: 404 };
    });

    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(true);
    expect(r.promptCount).toBe(1);
    expect(r.checkpointCount).toBe(1);
    expect(r.satisfiesGate).toBe(true);
    expect(r.resolvedRef).toBe(checkpointRef);
  });

  it("prefers a ref based checkpoint over the legacy branch when both exist", async () => {
    const checkpointRef = "refs/entire/checkpoints/WV/01M0JQB8SEQEVEZPP6R0G7VPWV";
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/matching-refs/entire/checkpoints")) {
        return { json: [{ ref: checkpointRef }] };
      }
      // Both the ref and the legacy branch resolve to a usable tree.
      if (url.includes("/git/trees/")) {
        return { json: { tree: [{ path: "0/prompt.txt", type: "blob" }] } };
      }
      if (url.includes("prompt.txt")) {
        return { json: { encoding: "base64", content: b64("one prompt") } };
      }
      return { status: 404 };
    });

    const r = await checkCheckpointBranch("o", "r");
    expect(r.satisfiesGate).toBe(true);
    expect(r.resolvedRef).toBe(checkpointRef);
  });

  it("does NOT pass when branch exists but is empty (no checkpoints, no prompts)", async () => {
    // Tree resolves but contains only unrelated files: no shard dirs, no prompts.
    const tree = { tree: [{ path: "README.md", type: "blob" }] };
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/trees/")) {
        if (url.includes(encodeURIComponent(ENTIRE_BRANCH))) return { json: tree };
        return { status: 404 };
      }
      return { status: 404 };
    });
    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(true);
    expect(r.promptCount).toBe(0);
    expect(r.satisfiesGate).toBe(false);
  });

  it("treats network errors as 'cannot confirm', not a false negative branchExists", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as FetchMock;
    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(false);
    expect(r.satisfiesGate).toBe(false);
    expect(r.notes.join(" ")).toMatch(/Could not query/);
  });
});

// ─── listEntireCheckpointRefs (mocked GitHub) ─────────────────

describe("listEntireCheckpointRefs", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps only the two level checkpoint ref shape", async () => {
    globalThis.fetch = mockFetch(() => ({
      json: [
        { ref: "refs/entire/checkpoints/WV/01M0JQB8SEQEVEZPP6R0G7VPWV" },
        { ref: "refs/entire/checkpoints/v1.1" }, // one level: not a checkpoint
        { ref: "refs/entire/checkpoints/WV/deep/er" }, // three levels
        { ref: "refs/heads/main" },
      ],
    }));
    const refs = await listEntireCheckpointRefs("o", "r", {});
    expect(refs).toEqual(["refs/entire/checkpoints/WV/01M0JQB8SEQEVEZPP6R0G7VPWV"]);
  });

  it("caps enumeration so a repo with many checkpoints stays bounded", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      ref: `refs/entire/checkpoints/AA/${String(i).padStart(26, "0")}`,
    }));
    let pages = 0;
    globalThis.fetch = mockFetch(() => {
      pages++;
      // Always a full page with distinct ids, so only the cap can stop it.
      return {
        json: page.map((item, i) => ({
          ref: `${item.ref}-${pages}-${i}`,
        })),
      };
    });
    const refs = await listEntireCheckpointRefs("o", "r", {});
    expect(refs.length).toBe(MAX_ENTIRE_CHECKPOINT_REFS);
    expect(pages).toBe(1);
  });
});

// ─── Whose fault is it: ours or the team's ───────────────────────────────────
//
// The Entire gate runs on the same GitHub credentials as everything else. When
// OUR side of that fails, the old code reported it as either "invite ehl-gg" or
// "you have no Entire record", both of which send a team chasing a problem they
// do not have, minutes before a deadline. These pin the separation.
describe("entireGateErrorMessage: our failure vs theirs", () => {
  const base: CheckpointBranchCheck = {
    branchExists: false,
    promptCount: 0,
    checkpointCount: 0,
    resolvedRef: null,
    repoUnreadable: false,
    checkUnavailable: false,
    satisfiesGate: false,
    notes: [],
  };

  it("owns the problem when the check could not be completed", () => {
    const msg = entireGateErrorMessage({ ...base, checkUnavailable: true });
    expect(msg).toMatch(/on us, not on you/i);
    expect(msg).toMatch(/try again/i);
  });

  it("never tells the team to change anything when the failure is ours", () => {
    const msg = entireGateErrorMessage({ ...base, checkUnavailable: true });
    expect(msg).not.toMatch(/ehl-gg/);
    expect(msg).not.toMatch(/entire enable/);
    expect(msg).not.toMatch(/recognized Entire checkpoint branch or ref/i);
    expect(msg).not.toMatch(/make the repository public/i);
  });

  it("leaks no infrastructure detail to the participant", () => {
    const msg = entireGateErrorMessage({ ...base, checkUnavailable: true });
    for (const leak of [/rate limit/i, /token/i, /401/, /403/, /quota/i, /github api/i]) {
      expect(msg).not.toMatch(leak);
    }
  });

  it("prefers our-failure over every team-facing message", () => {
    // checkUnavailable arrives alongside branchExists=false, and can coincide
    // with repoUnreadable; ours must win both.
    const msg = entireGateErrorMessage({
      ...base,
      branchExists: false,
      repoUnreadable: true,
      checkUnavailable: true,
    });
    expect(msg).toMatch(/on us, not on you/i);
    expect(msg).not.toMatch(/ehl-gg/);
  });

  it("still blames nobody but points the team at access when the repo is theirs to fix", () => {
    const msg = entireGateErrorMessage({ ...base, repoUnreadable: true });
    expect(msg).toMatch(/ehl-gg/);
    expect(msg).not.toMatch(/on us, not on you/i);
  });

  it("contains no em dash in any branch (house style)", () => {
    for (const c of [
      { ...base, checkUnavailable: true },
      { ...base, repoUnreadable: true },
      { ...base, branchExists: false },
      { ...base, branchExists: true },
    ]) {
      expect(entireGateErrorMessage(c)).not.toContain("—");
    }
  });
});

describe("recorded Entire checkpoint evidence", () => {
  const originalFetch = globalThis.fetch;
  const sha = "a".repeat(40);
  const codeSha = "b".repeat(40);
  const checkpointRef = "refs/entire/checkpoints/AA/0123456789";
  const checkpointRefs = [{ ref: checkpointRef, sha }];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it.each([
    checkpointRef,
    "refs/heads/entire/checkpoints/v1",
    "refs/entire/checkpoints/v1.1",
    "refs/heads/entire/checkpoints",
  ])("recognizes the supported checkpoint ref %s", (ref) => {
    expect(isEntireCheckpointRef(ref)).toBe(true);
  });

  it.each([
    "refs/heads/main",
    "refs/entire/checkpoints/AA",
    "refs/entire/checkpoints/AA/id/extra",
    "refs/entire/checkpoints/../id",
  ])("rejects unrelated or malformed ref %s", (ref) => {
    expect(isEntireCheckpointRef(ref)).toBe(false);
  });

  it.each(["participant-token", null])("uses the explicit token %s without a privileged settings lookup", async (token) => {
    vi.mocked(getSettingValue).mockClear();
    globalThis.fetch = mockFetch((url) => {
      if (url.includes(`/git/trees/${sha}?`)) {
        return { json: { tree: [{ path: "0/prompt.txt", type: "blob" }] } };
      }
      if (url.includes(`/contents/0/prompt.txt?ref=${sha}`)) {
        return { json: { encoding: "base64", content: b64("recorded prompt") } };
      }
      return { status: 404 };
    });

    const result = await checkCheckpointBranch("o", "r", { token, checkpointRefs });
    expect(result.satisfiesGate).toBe(true);
    expect(result.promptCount).toBe(1);
    expect(result.resolvedRef).toBe(checkpointRef);
    expect(getSettingValue).not.toHaveBeenCalled();
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([url]) => String(url))).toEqual([
      `https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`,
      `https://api.github.com/repos/o/r/contents/0/prompt.txt?ref=${sha}`,
    ]);
    for (const [, init] of calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(token ? `token ${token}` : null);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("does not discover new checkpoint refs when the recorded manifest is empty", async () => {
    globalThis.fetch = mockFetch(() => ({
      json: { tree: [{ path: "0/full.jsonl", type: "blob" }] },
    }));
    const result = await checkCheckpointBranch("o", "r", { token: null, checkpointRefs: [] });
    expect(result.satisfiesGate).toBe(false);
    expect(result.checkUnavailable).toBe(false);
    expect(result.branchExists).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops reading prompt files once the recorded submission has positive evidence", async () => {
    globalThis.fetch = mockFetch((url) => url.includes("/git/trees/")
      ? { json: { tree: [
        { path: "0/prompt.txt", type: "blob" },
        { path: "1/prompt.txt", type: "blob" },
      ] } }
      : { json: { encoding: "base64", content: b64("captured prompt") } });
    const result = await checkCheckpointBranch("o", "r", { token: null, checkpointRefs });
    expect(result.satisfiesGate).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`,
      `https://api.github.com/repos/o/r/contents/0/prompt.txt?ref=${sha}`,
    ]);
  });

  it("does not call a failed blob read missing evidence when there is no structural fallback", async () => {
    globalThis.fetch = mockFetch((url) => url.includes("/git/trees/")
      ? { json: { tree: [{ path: "0/prompt.txt", type: "blob" }] } }
      : { status: 429 });
    const result = await checkCheckpointBranch("o", "r", {
      token: null, checkpointRefs: [{ ref: "refs/heads/entire/checkpoints/v1", sha }],
    });
    expect(result.satisfiesGate).toBe(false);
    expect(result.checkUnavailable).toBe(true);
    expect(result.repoUnreadable).toBe(false);
  });

  it("does not replace an unavailable recorded object with a newer live ref", async () => {
    globalThis.fetch = mockFetch((url) => url.includes(`/git/trees/${sha}?`)
      ? { status: 404 }
      : { json: { tree: [{ path: "0/full.jsonl", type: "blob" }] } });
    const result = await checkCheckpointBranch("o", "r", { token: null, checkpointRefs });
    expect(result.satisfiesGate).toBe(false);
    expect(result.checkUnavailable).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`,
    ]);
  });

  it("retains the structural fallback on the recorded older short branch", async () => {
    globalThis.fetch = mockFetch(() => ({
      json: { tree: [{ path: "a3/b2c4d5e6f7/data.bin", type: "blob" }] },
    }));
    const result = await checkCheckpointBranch("o", "r", {
      token: null, checkpointRefs: [{ ref: "refs/heads/entire/checkpoints", sha }],
    });
    expect(result.satisfiesGate).toBe(true);
    expect(result.promptCount).toBe(1);
    expect(result.checkpointCount).toBe(1);
  });

  it("does not accept an empty recorded checkpoint tree", async () => {
    globalThis.fetch = mockFetch(() => ({ json: { tree: [] } }));
    const result = await checkCheckpointBranch("o", "r", { token: null, checkpointRefs });
    expect(result.satisfiesGate).toBe(false);
    expect(result.promptCount).toBe(0);
    expect(result.checkUnavailable).toBe(false);
  });

  it("does not treat the mirror branch name alone as a checkpoint", async () => {
    globalThis.fetch = mockFetch(() => ({ json: { tree: [{ path: "README.md", type: "blob" }] } }));
    const result = await checkCheckpointBranch("o", "r", {
      token: null, checkpointRefs: [{ ref: "refs/entire/checkpoints/v1.1", sha }],
    });
    expect(result.satisfiesGate).toBe(false);
    expect(result.promptCount).toBe(0);
    expect(result.checkpointCount).toBe(0);
  });

  it("checks the next recorded ref when the first tree has no evidence", async () => {
    globalThis.fetch = mockFetch((url) => url.includes(`/git/trees/${sha}?`)
      ? { json: { tree: [] } }
      : { json: { tree: [{ path: "0/full.jsonl", type: "blob" }] } });
    const result = await checkCheckpointBranch("o", "r", {
      token: null, checkpointRefs: [...checkpointRefs, { ref: "refs/entire/checkpoints/BB/id", sha: codeSha }],
    });
    expect(result.satisfiesGate).toBe(true);
    expect(result.resolvedRef).toBe("refs/entire/checkpoints/BB/id");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`,
      `https://api.github.com/repos/o/r/git/trees/${codeSha}?recursive=1`,
    ]);
  });

  it("reports an unfinished bounded scan as unavailable rather than missing evidence", async () => {
    globalThis.fetch = mockFetch(() => ({ json: { tree: [] } }));
    const result = await checkCheckpointBranch("o", "r", {
      token: null,
      checkpointRefs: Array.from({ length: 150 }, (_, i) => ({ ref: `refs/entire/checkpoints/AA/${i}`, sha })),
    });
    expect(result.satisfiesGate).toBe(false);
    expect(result.checkUnavailable).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length).toBe(103);
  });

  it("samples review history from the recorded objects and the submitted commit", async () => {
    globalThis.fetch = mockFetch((url) => {
      if (url.includes(`/git/trees/${sha}?`)) return { json: { tree: [
        { path: "0/prompt.txt", type: "blob" },
        { path: "0/metadata.json", type: "blob" },
      ] } };
      if (url.includes(`/contents/0/prompt.txt?ref=${sha}`)) {
        return { json: { encoding: "base64", content: b64("on time prompt") } };
      }
      if (url.includes(`/contents/0/metadata.json?ref=${sha}`)) {
        return { json: { encoding: "base64", content: b64(JSON.stringify({ agent: "Codex", files: ["app.ts"] })) } };
      }
      if (url.includes(`/commits?sha=${codeSha}&`)) {
        return { json: [{ commit: { verification: { verified: true } } }] };
      }
      return { status: 404 };
    });
    const result = await ingestSessionHistory("o", "r", { checkpointRefs, commitSha: codeSha });
    expect(result?.promptSamples).toEqual(["on time prompt"]);
    expect(result?.agentsDetected).toEqual(["Codex"]);
    expect(result?.filesTouched).toEqual(["app.ts"]);
    expect(result?.signed).toBe(true);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.github.com/repos/o/r/git/trees/${sha}?recursive=1`,
      `https://api.github.com/repos/o/r/contents/0/prompt.txt?ref=${sha}`,
      `https://api.github.com/repos/o/r/contents/0/metadata.json?ref=${sha}`,
      `https://api.github.com/repos/o/r/commits?sha=${codeSha}&per_page=1`,
    ]);
  });

  it("does not discover review history outside an empty recorded manifest", async () => {
    globalThis.fetch = mockFetch(() => ({ json: { tree: [{ path: "0/full.jsonl", type: "blob" }] } }));
    expect(await ingestSessionHistory("o", "r", { checkpointRefs: [], commitSha: codeSha })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("incomplete Entire checks", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it.each([401, 403, 429, 500])("does not turn ref enumeration HTTP %i into missing Entire", async (status) => {
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/matching-refs/")) return { status };
      if (/\/repos\/o\/r$/.test(url)) return { json: { private: false } };
      return { status: 404 };
    });
    const result = await checkCheckpointBranch("o", "r");
    expect(result.checkUnavailable).toBe(true);
    expect(result.satisfiesGate).toBe(false);
    expect(result.repoUnreadable).toBe(false);
  });

  it.each([403, 429, 500])("does not turn tree HTTP %i into missing Entire", async (status) => {
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/matching-refs/")) return { json: [] };
      if (url.includes("/git/trees/")) return { status };
      return { json: { private: false } };
    });
    const result = await checkCheckpointBranch("o", "r");
    expect(result.checkUnavailable).toBe(true);
    expect(result.satisfiesGate).toBe(false);
  });

  it("treats a rate limited access probe as an unavailable check", async () => {
    globalThis.fetch = mockFetch((url) => /\/repos\/o\/r$/.test(url) ? { status: 429 } : { status: 404 });
    const result = await checkCheckpointBranch("o", "r");
    expect(result.checkUnavailable).toBe(true);
    expect(result.repoUnreadable).toBe(false);
    expect(result.satisfiesGate).toBe(false);
  });

  it("does not turn a malformed enumeration response into missing Entire", async () => {
    globalThis.fetch = mockFetch((url) => {
      if (url.includes("/git/matching-refs/")) return { json: { unexpected: true } };
      if (/\/repos\/o\/r$/.test(url)) return { json: {} };
      return { status: 404 };
    });
    const result = await checkCheckpointBranch("o", "r");
    expect(result.checkUnavailable).toBe(true);
    expect(result.satisfiesGate).toBe(false);
  });

  it("does not claim missing history from a truncated tree", async () => {
    globalThis.fetch = mockFetch((url) => url.includes("/git/matching-refs/")
      ? { json: [] }
      : { json: { truncated: true, tree: [{ path: "README.md", type: "blob" }] } });
    const result = await checkCheckpointBranch("o", "r");
    expect(result.checkUnavailable).toBe(true);
    expect(result.satisfiesGate).toBe(false);
  });
});
