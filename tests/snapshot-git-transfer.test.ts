import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepositoryCapture } from "@/lib/submission-snapshots/types";
const state = vi.hoisted(() => ({
  source: "",
  destination: "",
  calls: [] as string[][],
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  type Options = import("node:child_process").ExecFileOptions;
  type Failure = import("node:child_process").ExecFileException | null;
  const wrapped = (
    command: string,
    args: string[],
    options: Options,
    callback: (error: Failure, stdout: string, stderr: string) => void,
  ) => {
    state.calls.push(args);
    const local = args.map((a) =>
      a === "https://github.com/source/repo.git"
        ? state.source
        : a === "https://github.com/snapshots/repo.git"
          ? state.destination
          : a,
    );
    return actual.execFile(
      command,
      local,
      {
        ...options,
        encoding: "utf8",
        env: { ...process.env, ...options.env, GIT_CONFIG_VALUE_1: "always" },
      },
      callback,
    );
  };
  Object.defineProperty(wrapped, promisify.custom, {
    value: (command: string, args: string[], options: Options) =>
      new Promise((resolve, reject) => {
        wrapped(command, args, options, (error, stdout, stderr) =>
          error ? reject(error) : resolve({ stdout, stderr }),
        );
      }),
  });
  return { ...actual, execFile: wrapped };
});
import { transferCapturedRepository } from "@/lib/submission-snapshots/git-transfer";
const actual =
  await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
const exec = promisify(actual.execFile);
let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function repositoryFixture() {
  directory = await mkdtemp(join(tmpdir(), "capture-test-"));
  state.source = join(directory, "source");
  state.destination = join(directory, "destination.git");
  state.calls = [];
  await exec("git", ["init", state.source]);
  await exec("git", ["init", "--bare", state.destination]);
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: state.source })).stdout.trim();
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.invalid");
  await writeFile(join(state.source, "main.txt"), "first");
  await git("add", ".");
  await git("commit", "-m", "first");
  const parent = await git("rev-parse", "HEAD");
  await writeFile(join(state.source, "main.txt"), "second");
  await git("commit", "-am", "second");
  const sha = await git("rev-parse", "HEAD");
  const destination = async (...args: string[]) =>
    (
      await exec("git", ["--git-dir", state.destination, ...args])
    ).stdout.trim();
  return { git, destination, parent, sha };
}
it("copies full ancestry and frozen Entire refs into an empty bare destination without checkout", async () => {
  const { git, destination, parent, sha } = await repositoryFixture();
  const ref = "refs/entire/checkpoints/aa/checkpoint";
  await git("update-ref", ref, parent);
  await transferCapturedRepository(
    {
      repo_url: "https://github.com/source/repo",
      repository_id: 42,
      fork_url: "https://github.com/snapshots/repo",
      frozen_sha: sha,
      revision: 2,
      entire_required: false,
      checkpoint_manifest: [{ ref, sha: parent }],
    },
    "test-only-token",
    async () => {},
  );
  expect(await destination("rev-parse", "refs/heads/ehl-final/2")).toBe(sha);
  expect(await destination("rev-parse", `${sha}^`)).toBe(parent);
  expect(await destination("rev-parse", `refs/heads/ehl-checkpoints/2/${parent}`)).toBe(parent);
  expect((await destination("for-each-ref", "--format=%(refname)")).split("\n")).toEqual([
    `refs/heads/ehl-checkpoints/2/${parent}`,
    "refs/heads/ehl-final/2",
  ]);
  expect(state.calls.flat()).not.toContain("--depth=1");
  expect(state.calls.some((args) => args.includes("checkout"))).toBe(false);
  expect(state.calls.flat().join(" ")).not.toContain("test-only-token");
});
it.each(["refs/heads/entire/checkpoints/v1", "refs/heads/entire/checkpoints"])("retains accepted Entire objects without imposing a second gate or following newer source refs: %s", async (legacyRef) => {
  const { git, destination, parent, sha } = await repositoryFixture();
  const refs = [
    "refs/entire/checkpoints/aa/checkpoint",
    legacyRef,
    "refs/entire/checkpoints/v1.1",
  ];
  for (const ref of refs) await git("update-ref", ref, sha);
  await transferCapturedRepository({
    repo_url: "https://github.com/source/repo", repository_id: 42,
    fork_url: "https://github.com/snapshots/repo", frozen_sha: parent, revision: 1,
    entire_required: true,
    checkpoint_manifest: refs.map(ref => ({ ref, sha: parent })),
  }, "test-only-token", async () => {});
  expect(await destination("rev-parse", "refs/heads/ehl-final/1")).toBe(parent);
  expect(await destination("rev-parse", `refs/heads/ehl-checkpoints/1/${parent}`)).toBe(parent);
  expect((await destination("for-each-ref", "--format=%(objectname)")).split("\n")).toEqual([parent, parent]);
  expect(state.calls.some(args => args[0] === "ls-tree" || args[0] === "show")).toBe(false);
  expect(state.calls.filter(args => args[0] === "fetch")).toEqual([
    ["fetch", "--no-tags", "https://github.com/source/repo.git", parent],
  ]);
});
it("an older worker finishing later cannot change a newer revision's code or Entire refs", async () => {
  const { destination, parent, sha } = await repositoryFixture();
  const capture = (revision: number, commit: string): RepositoryCapture => ({
    repo_url: "https://github.com/source/repo", repository_id: 42,
    fork_url: "https://github.com/snapshots/repo", frozen_sha: commit, revision,
    entire_required: false,
    checkpoint_manifest: [{ ref: "refs/heads/entire/checkpoints/v1", sha: commit }],
  });
  await transferCapturedRepository(capture(2, sha), "test-only-token", async () => {});
  await transferCapturedRepository(capture(1, parent), "test-only-token", async () => {});
  await transferCapturedRepository(capture(1, parent), "test-only-token", async () => {});
  expect(await destination("rev-parse", "refs/heads/ehl-final/2")).toBe(sha);
  expect(await destination("rev-parse", `refs/heads/ehl-checkpoints/2/${sha}`)).toBe(sha);
  expect(await destination("rev-parse", "refs/heads/ehl-final/1")).toBe(parent);
  expect(await destination("rev-parse", `refs/heads/ehl-checkpoints/1/${parent}`)).toBe(parent);
  expect((await destination("for-each-ref", "--format=%(refname)")).split("\n")).toEqual([
    `refs/heads/ehl-checkpoints/1/${parent}`,
    `refs/heads/ehl-checkpoints/2/${sha}`,
    "refs/heads/ehl-final/1",
    "refs/heads/ehl-final/2",
  ]);
});
it("reports an unavailable accepted commit without copying the current source head", async () => {
  const { destination } = await repositoryFixture();
  await expect(transferCapturedRepository({
    repo_url: "https://github.com/source/repo", repository_id: 42,
    fork_url: "https://github.com/snapshots/repo", frozen_sha: "f".repeat(40), revision: 1,
    entire_required: false, checkpoint_manifest: [],
  }, "test-only-token", async () => {})).rejects.toMatchObject({ kind: "access" });
  expect(await destination("for-each-ref", "--format=%(refname)")).toBe("");
  expect(state.calls.some(args => args[0] === "push")).toBe(false);
});
