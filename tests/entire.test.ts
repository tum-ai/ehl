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
  ENTIRE_BRANCH,
} from "@/lib/entire";
import type { CheckpointBranchCheck } from "@/lib/types";

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
    satisfiesGate: false,
    notes: [],
  };

  it("gives a 'no branch' message when the branch is absent", () => {
    const msg = entireGateErrorMessage({ ...base, branchExists: false });
    expect(msg).toContain(ENTIRE_BRANCH);
    expect(msg).toMatch(/entire enable/);
  });

  it("gives a 'no prompts' message when the branch exists but is empty", () => {
    const msg = entireGateErrorMessage({ ...base, branchExists: true });
    expect(msg).toMatch(/could not find any captured prompts/i);
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

  it("reports no branch when all candidate refs 404", async () => {
    globalThis.fetch = mockFetch(() => ({ status: 404 }));
    const r = await checkCheckpointBranch("o", "r");
    expect(r.branchExists).toBe(false);
    expect(r.satisfiesGate).toBe(false);
    expect(r.resolvedRef).toBeNull();
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
