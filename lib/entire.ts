/**
 * Entire.io session-history integration.
 *
 * Entire (https://entire.io, https://github.com/entireio/cli) is a client-side
 * CLI that captures AI coding-agent sessions and stores them, agent-agnostic, on
 * an orphan git branch `entire/checkpoints/v1`. Each commit gets an
 * `Entire-Checkpoint: <12hex>` trailer linking it to a checkpoint.
 *
 * On-branch layout (per the open-source CLI, paths/paths.go + checkpoint/*.go):
 *
 *   <id[:2]>/<id[2:]>/                 sharded checkpoint dir (id = 12 lowercase hex)
 *     metadata.json                    CheckpointSummary (sessions map, aggregate stats)
 *     0/  1/  ...                      one subdir per session in the checkpoint
 *       metadata.json                  CommittedMetadata (per-session)
 *       prompt.txt                     user prompts joined by "\n\n---\n\n"
 *       full.jsonl                     normalized transcript (legacy: full.log)
 *
 * IMPORTANT — the check is intentionally SOFT and agent-agnostic:
 *
 *   Raw agent transcripts differ wildly (Codex has two distinct rollout formats,
 *   Claude/Gemini/Cursor each differ). Entire normalizes them into the committed
 *   layout above, but normalization quality varies per agent and per Entire
 *   version, and older/newer versions store slightly differently (e.g. full.log
 *   vs full.jsonl, the v1.1 mirror ref, prompt counts living in metadata vs
 *   prompt.txt). We therefore NEVER hard-parse agent-specific formats and NEVER
 *   reject on a malformed file. We look only at Entire's normalized artifacts,
 *   try several fallbacks, and accept ANY positive signal. A Codex checkpoint
 *   missing a clean prompt.txt still passes if metadata or a transcript blob is
 *   present. The hard gate is deliberately the weakest meaningful bar: the branch
 *   exists AND at least one prompt/checkpoint can be found by any route.
 */

import { getSettingValue, SETTING_KEYS } from "@/lib/settings";
import type { CheckpointBranchCheck } from "@/lib/types";

// The canonical metadata branch, plus known mirror/legacy refs to fall back on.
// Order matters: first match wins.
export const ENTIRE_BRANCH = "entire/checkpoints/v1";
export const ENTIRE_CANDIDATE_REFS = [
  "entire/checkpoints/v1", // MetadataBranchName
  "refs/entire/checkpoints/v1.1", // MetadataRefName (v1.1 read mirror)
  "entire/checkpoints", // defensive: older/short form
];

// Canonical separator used in prompt.txt when multiple prompts are stored in one
// file (checkpoint/prompts.go: PromptSeparator).
const PROMPT_SEPARATOR = "\n\n---\n\n";

// Sharded checkpoint id directory: <2 hex>/<10 hex> (id/id.go: CheckpointID.Path).
const SHARD_RE = /^[0-9a-f]{2}$/;
const REST_RE = /^[0-9a-f]{10}$/;

// Commit trailer linking a commit to a checkpoint (id is 12 lowercase hex).
const TRAILER_RE = /^Entire-Checkpoint:\s*([0-9a-f]{12})\s*$/im;

async function getGitHubToken(): Promise<string | null> {
  return getSettingValue(SETTING_KEYS.GITHUB_TOKEN, process.env.GITHUB_TOKEN);
}

/**
 * User-facing error shown when the Entire hard gate fails. Distinguishes the two
 * failure modes (no branch at all vs. branch present but no prompt) so teams know
 * exactly what to fix. Kept here so the submit action and the live verify-repo
 * pre-check show identical wording.
 */
export function entireGateErrorMessage(check: CheckpointBranchCheck): string {
  if (!check.branchExists) {
    return (
      "This challenge requires an Entire session record, but your repository has no " +
      `${ENTIRE_BRANCH} branch. Install Entire (https://entire.io), run ` +
      "`entire enable --agent <your-tool>`, commit your AI session, push (including the " +
      "checkpoint branch), then resubmit. If your repo is private, make sure ehl-gg has " +
      "access so we can read it."
    );
  }
  return (
    `Your repository has the ${ENTIRE_BRANCH} branch, but we could not find any captured ` +
    "prompts in it. Make sure you committed while your AI coding session was active so " +
    "Entire records at least one prompt, then push and resubmit."
  );
}

function getHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "EHL-Entire-Check",
  };
  if (token) headers.Authorization = `token ${token}`;
  return headers;
}

// ─── Pure parsing / heuristics (unit-tested without network) ──────────────────

/**
 * Count prompts in a prompt.txt blob. Tolerant: trims, ignores empty trailing
 * segments, and treats a non-empty file with no separators as a single prompt.
 */
export function countPromptsInPromptTxt(content: string): number {
  if (!content || !content.trim()) return 0;
  const parts = content
    .split(PROMPT_SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length;
}

/**
 * Best-effort prompt count from a session/checkpoint metadata.json object.
 * Different Entire versions expose this differently; we accept any of the known
 * shapes and never throw on unexpected ones. Returns 0 when nothing usable.
 */
export function promptCountFromMetadata(meta: unknown): number {
  if (!meta || typeof meta !== "object") return 0;
  const m = meta as Record<string, unknown>;

  // Newer: an explicit prompts array on the session metadata.
  if (Array.isArray(m.prompts)) {
    return m.prompts.filter((p) => typeof p === "string" && p.trim()).length;
  }

  // CommittedMetadata historically stored the displayed prompt count under
  // checkpoints_count / checkpointsCount (floored at 1 per the CLI comments).
  for (const key of ["prompt_count", "promptCount", "checkpoints_count", "checkpointsCount"]) {
    const v = m[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      return Math.floor(v);
    }
  }

  // CheckpointSummary exposes a sessions map; each session implies >= 1 prompt.
  if (m.sessions && typeof m.sessions === "object") {
    const count = Object.keys(m.sessions as Record<string, unknown>).length;
    if (count > 0) return count;
  }

  return 0;
}

/** Whether a path looks like the per-session subdir prompt file. */
export function isPromptFilePath(path: string): boolean {
  return /(^|\/)prompt\.txt$/.test(path);
}

/** Whether a path looks like a transcript blob (current or legacy). */
export function isTranscriptFilePath(path: string): boolean {
  return /(^|\/)full\.(jsonl|log)$/.test(path);
}

/**
 * Given the recursive tree (list of paths) of the checkpoint branch, count the
 * sharded checkpoint directories. A path like "a3/b2c4d5e6f7/metadata.json"
 * implies one checkpoint dir "a3/b2c4d5e6f7".
 */
export function countCheckpointDirs(paths: string[]): number {
  const dirs = new Set<string>();
  for (const p of paths) {
    const segs = p.split("/");
    if (segs.length >= 2 && SHARD_RE.test(segs[0]) && REST_RE.test(segs[1])) {
      dirs.add(`${segs[0]}/${segs[1]}`);
    }
  }
  return dirs.size;
}

/** Extract the checkpoint id from a commit message trailer, if present. */
export function extractCheckpointTrailer(commitMessage: string): string | null {
  const m = commitMessage.match(TRAILER_RE);
  return m ? m[1] : null;
}

// ─── Network: soft presence check against a repo ──────────────────────────────

type TreeItem = { path: string; type: string };

/**
 * Resolve which candidate ref actually exists on the repo and return its
 * recursive tree. Returns null if no Entire branch/ref is present.
 */
async function fetchCheckpointTree(
  owner: string,
  repo: string,
  headers: Record<string, string>
): Promise<{ ref: string; items: TreeItem[] } | null> {
  for (const ref of ENTIRE_CANDIDATE_REFS) {
    // git/trees accepts a branch name or ref. Use the recursive tree so we see
    // every file at once (the branch is small: metadata + transcripts only).
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(
        ref
      )}?recursive=1`,
      { headers }
    );
    if (res.status === 404) continue; // ref doesn't exist; try next candidate
    if (!res.ok) continue; // transient/other error: don't claim absence, keep trying
    const data = (await res.json().catch(() => null)) as {
      tree?: TreeItem[];
      truncated?: boolean;
    } | null;
    if (data?.tree && data.tree.length > 0) {
      return { ref, items: data.tree };
    }
  }
  return null;
}

async function fetchBlobText(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  headers: Record<string, string>
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(ref)}`,
    { headers }
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    content?: string;
    encoding?: string;
  } | null;
  if (!data || data.encoding !== "base64" || !data.content) return null;
  try {
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Soft, agent-agnostic check of whether a repo carries an Entire session record.
 *
 * Strategy (every step is best-effort; failure of one falls through to the next):
 *  1. Find a checkpoint branch/ref and read its tree. No tree -> no record.
 *  2. Count sharded checkpoint dirs (structural presence).
 *  3. Count prompts: read up to a few prompt.txt blobs and sum; if none parse,
 *     fall back to session metadata.json prompt counts; if still none, accept a
 *     transcript blob or any checkpoint dir as "1" (a record exists, even if the
 *     prompt file is malformed for this agent/version).
 *
 * The gate (satisfiesGate) is: branch exists AND promptCount >= 1.
 */
export async function checkCheckpointBranch(
  owner: string,
  repo: string,
  opts: { maxPromptFiles?: number } = {}
): Promise<CheckpointBranchCheck> {
  const notes: string[] = [];
  const empty: CheckpointBranchCheck = {
    branchExists: false,
    promptCount: 0,
    checkpointCount: 0,
    resolvedRef: null,
    satisfiesGate: false,
    notes,
  };

  const token = await getGitHubToken();
  const headers = getHeaders(token);

  let tree: { ref: string; items: TreeItem[] } | null;
  try {
    tree = await fetchCheckpointTree(owner, repo, headers);
  } catch (e) {
    notes.push(
      `Could not query the Entire branch (${e instanceof Error ? e.message : "network error"}).`
    );
    return empty;
  }

  if (!tree) {
    notes.push(`No Entire checkpoint branch found (looked for ${ENTIRE_BRANCH}).`);
    return empty;
  }

  const paths = tree.items.filter((t) => t.type === "blob").map((t) => t.path);
  const checkpointCount = countCheckpointDirs(paths);

  // Step 3a: prompt.txt blobs (cap reads to stay cheap; this is a submit-time check).
  const maxPromptFiles = opts.maxPromptFiles ?? 10;
  const promptFiles = paths.filter(isPromptFilePath).slice(0, maxPromptFiles);
  let promptCount = 0;
  for (const p of promptFiles) {
    const content = await fetchBlobText(owner, repo, tree.ref, p, headers);
    if (content == null) {
      notes.push(`Prompt file ${p} present but unreadable; skipped.`);
      continue;
    }
    promptCount += countPromptsInPromptTxt(content);
  }

  // Step 3b: metadata fallback when no prompt.txt yielded anything.
  if (promptCount === 0) {
    const metaFiles = paths.filter((p) => /(^|\/)metadata\.json$/.test(p)).slice(0, maxPromptFiles);
    for (const p of metaFiles) {
      const content = await fetchBlobText(owner, repo, tree.ref, p, headers);
      if (content == null) continue;
      try {
        promptCount += promptCountFromMetadata(JSON.parse(content));
      } catch {
        // malformed metadata: ignore, keep trying others
      }
    }
    if (promptCount > 0) {
      notes.push("Counted prompts via metadata fallback (no usable prompt.txt).");
    }
  }

  // Step 3c: last-resort structural signal. A transcript blob or any checkpoint
  // dir means a session was captured even if we couldn't count discrete prompts
  // (e.g. an agent/version whose prompt file we can't read). Count it as 1.
  if (promptCount === 0) {
    const hasTranscript = paths.some(isTranscriptFilePath);
    if (hasTranscript || checkpointCount > 0) {
      promptCount = 1;
      notes.push(
        hasTranscript
          ? "No countable prompts, but a transcript is present; accepting as 1."
          : "No countable prompts, but a checkpoint directory exists; accepting as 1."
      );
    }
  }

  const branchExists = true;
  return {
    branchExists,
    promptCount,
    checkpointCount,
    resolvedRef: tree.ref,
    satisfiesGate: branchExists && promptCount >= 1,
    notes,
  };
}

// ─── Rich ingest for the code-review pipeline ─────────────────────────────────

/** A bounded, redaction-trusting sample of an Entire session record. */
export interface SessionHistoryIngest {
  resolvedRef: string;
  checkpointCount: number;
  promptCount: number;
  // Up to `maxPrompts` prompt strings, truncated, for the LLM rubric.
  promptSamples: string[];
  // Agents/tools detected from checkpoint metadata (Claude Code, Codex, ...).
  agentsDetected: string[];
  // Files reported as touched across checkpoints (bounded).
  filesTouched: string[];
  // Whether the checkpoint commits are cryptographically signed (verified=true
  // on the latest checkpoint commits). A trust booster, never a hard gate.
  signed: boolean;
  notes: string[];
}

/**
 * Read a bounded sample of the session record for the pipeline. This deliberately
 * does NOT attempt to re-verify integrity cryptographically (GitHub already
 * reports commit signature verification); it gathers prompts + metadata for the
 * advisory LLM rubric. Tolerant of missing fields. Returns null when there is no
 * usable record.
 */
export async function ingestSessionHistory(
  owner: string,
  repo: string,
  opts: { maxPrompts?: number; maxPromptChars?: number } = {}
): Promise<SessionHistoryIngest | null> {
  const maxPrompts = opts.maxPrompts ?? 40;
  const maxPromptChars = opts.maxPromptChars ?? 4000;
  const notes: string[] = [];

  const token = await getGitHubToken();
  const headers = getHeaders(token);

  let tree: { ref: string; items: TreeItem[] } | null;
  try {
    tree = await fetchCheckpointTree(owner, repo, headers);
  } catch {
    return null;
  }
  if (!tree) return null;

  const paths = tree.items.filter((t) => t.type === "blob").map((t) => t.path);
  const checkpointCount = countCheckpointDirs(paths);

  // Collect prompt samples.
  const promptSamples: string[] = [];
  let promptCount = 0;
  for (const p of paths.filter(isPromptFilePath)) {
    if (promptSamples.length >= maxPrompts) break;
    const content = await fetchBlobText(owner, repo, tree.ref, p, headers);
    if (content == null) continue;
    for (const prompt of content.split(PROMPT_SEPARATOR)) {
      const trimmed = prompt.trim();
      if (!trimmed) continue;
      promptCount++;
      if (promptSamples.length < maxPrompts) {
        promptSamples.push(trimmed.slice(0, maxPromptChars));
      }
    }
  }

  // Collect agents + files-touched from metadata.json blobs (bounded).
  const agents = new Set<string>();
  const files = new Set<string>();
  for (const p of paths.filter((x) => /(^|\/)metadata\.json$/.test(x)).slice(0, maxPrompts)) {
    const content = await fetchBlobText(owner, repo, tree.ref, p, headers);
    if (content == null) continue;
    try {
      const meta = JSON.parse(content) as Record<string, unknown>;
      for (const key of ["agent", "Agent", "agent_type"]) {
        const v = meta[key];
        if (typeof v === "string" && v.trim()) agents.add(v.trim());
      }
      for (const key of ["files_touched", "filesTouched", "files"]) {
        const v = meta[key];
        if (Array.isArray(v)) v.forEach((f) => typeof f === "string" && files.add(f));
      }
      if (promptCount === 0) promptCount += promptCountFromMetadata(meta);
    } catch {
      // ignore malformed metadata
    }
  }

  // Signing status: check the latest commit on the checkpoint branch for a
  // verified signature. Best-effort; absence is not penalized here.
  let signed = false;
  try {
    const refForCommit = tree.ref.startsWith("refs/")
      ? tree.ref
      : `heads/${tree.ref}`;
    const commitsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(
        refForCommit.replace(/^heads\//, "")
      )}&per_page=1`,
      { headers }
    );
    if (commitsRes.ok) {
      const arr = (await commitsRes.json()) as Array<{
        commit?: { verification?: { verified?: boolean } };
      }>;
      signed = !!arr?.[0]?.commit?.verification?.verified;
    }
  } catch {
    // ignore
  }

  if (promptSamples.length === 0 && checkpointCount === 0) {
    notes.push("Checkpoint branch present but no readable prompts or checkpoints.");
  }

  return {
    resolvedRef: tree.ref,
    checkpointCount,
    promptCount,
    promptSamples,
    agentsDetected: [...agents],
    filesTouched: [...files].slice(0, 200),
    signed,
    notes,
  };
}
