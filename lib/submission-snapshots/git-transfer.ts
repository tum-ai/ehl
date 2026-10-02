import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubFailure } from "./github-client";
import { strictRepository, type RepositoryCapture } from "./types";
const exec = promisify(execFile);

export function classifyGitTransferFailure(error: unknown): GitHubFailure {
  const text =
    error && typeof error === "object" && "stderr" in error
      ? String(error.stderr)
      : error instanceof Error ? error.message : "";
  if (/not our ref|couldn't find remote ref|unadvertised object|not a valid object|reference is not a tree/i.test(text))
    return new GitHubFailure(
      "Accepted repository objects are no longer available",
      "access",
    );
  const permanent =
    /permission denied|authentication failed|could not read Username|repository not found|remote rejected|shallow update not allowed|non-fast-forward|protected branch|GH00[0-9]/i.test(
      text,
    );
  // Never persist raw Git stderr: it can contain private paths and credentials.
  return new GitHubFailure(
    permanent
      ? "Git transfer refused. Check bot access and destination policy."
      : "Git transfer failed; a bounded retry is scheduled.",
    permanent ? "configuration" : "transient",
  );
}

/** Bare Git only: never checks out or runs submitted files, hooks or dependencies. */
export async function transferCapturedRepository(
  r: RepositoryCapture,
  token: string,
  heartbeat: () => Promise<void>,
) {
  if (!r.frozen_sha || !/^[a-f0-9]{40}$/.test(r.frozen_sha) || !r.fork_url ||
      !Number.isSafeInteger(r.revision) || r.revision < 1)
    throw new Error("Missing immutable capture");
  strictRepository(r.repo_url);
  strictRepository(r.fork_url);
  const directory = await mkdtemp(join(tmpdir(), "ehl-capture-"));
  const askpass = join(directory, "askpass.sh");
  await writeFile(
    askpass,
    '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$EHL_CAPTURE_GIT_TOKEN" ;; esac\n',
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: askpass,
    EHL_CAPTURE_GIT_TOKEN: token,
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "protocol.file.allow",
    GIT_CONFIG_VALUE_1: "never",
    GIT_CONFIG_KEY_2: "credential.helper",
    GIT_CONFIG_VALUE_2: "",
  };
  const git = async (...args: string[]) => {
    await heartbeat();
    try {
      return (
        await exec("git", args, {
          cwd: directory,
          env,
          timeout: 60000,
          maxBuffer: 16 * 1024 * 1024,
        })
      ).stdout;
    } catch (error) {
      throw classifyGitTransferFailure(error);
    }
  };
  try {
    await git("init", "--bare", ".");
    const shas = [
      ...new Set([r.frozen_sha, ...r.checkpoint_manifest.map((c) => c.sha)]),
    ];
    if (shas.some((sha) => !/^[a-f0-9]{40}$/.test(sha)))
      throw new Error("Invalid frozen checkpoint");
    await git("fetch", "--no-tags", `${r.repo_url}.git`, ...shas);
    // Entire evidence was verified against these objects before receipt. Check
    // transfer identity only; a second, different gate could reject accepted work.
    const resolved = (await git("rev-parse", ...shas.map(sha => `${sha}^{commit}`)))
      .trim().split("\n");
    if (resolved.length !== shas.length || resolved.some((sha, index) => sha !== shas[index]))
      throw new Error("Frozen commit mismatch");
    const refs = [`${r.frozen_sha}:refs/heads/ehl-final/${r.revision}`];
    for (const sha of new Set(r.checkpoint_manifest.map(checkpoint => checkpoint.sha))) {
      // A superseded worker can finish a Git push after losing its database lease.
      // Revision/object-specific destinations cannot move another revision's refs.
      // Source ref spelling is irrelevant, including every accepted legacy shape.
      refs.push(`${sha}:refs/heads/ehl-checkpoints/${r.revision}/${sha}`);
    }
    await git("push", "--atomic", `${r.fork_url}.git`, ...refs);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
