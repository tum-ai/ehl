import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SnapshotWorker } from "@/lib/submission-snapshots/worker";
import { SnapshotGitHub } from "@/lib/submission-snapshots/github-client";
import { dispatchPendingSnapshots } from "@/lib/submission-snapshots/dispatch";
import type { RepositoryCapture, RepositorySelection } from "@/lib/submission-snapshots/types";
const sha = "a".repeat(40);
let identity = 0;
function setup(
  opts: { limited?: boolean; entire?: boolean; failures?: number; jury?: boolean; missingSelection?: boolean; sourceUnavailable?: boolean; sourceId?: number; sourceSha?: string; forkStatus?: 404 | 202 } = {},
) {
  identity++;
  const selection: RepositorySelection = {
    repo_url: "https://github.com/source/project",
    repository_id: 42,
    frozen_sha: sha,
    entire_required: !!opts.entire,
    checkpoint_manifest: opts.entire ? Array.from({ length: 334 }, (_, i) => ({
      ref: `refs/entire/checkpoints/aa/${i}`, sha,
    })) : [],
  };
  const snapshots: Record<string, RepositorySelection> = opts.missingSelection ? {} : { repo: selection };
  const job = {
    submission_id: "submission",
    revision: 1,
    lease_token: "lease",
    failures: opts.failures ?? 0,
    step: {} as Record<string, RepositoryCapture & { complete?: boolean }>,
  };
  const patches: Record<string, unknown>[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>): Promise<{
    data: unknown; error: { message: string } | null;
  }> => {
    if (name === "claim_submission_snapshot")
      return { data: [job], error: null };
    if (name === "update_submission_snapshot") {
      patches.push(structuredClone(args));
      return { data: true, error: null };
    }
    if (name === "reserve_snapshot_request") return { data: 0, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  const update = vi.fn();
  const db = {
    rpc,
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const key of ["select", "eq", "in"]) b[key] = () => b;
      b.update = (patch: unknown) => {
        update(patch);
        return b;
      };
      b.single = async () => ({
        error: null,
        data:
          table === "submissions"
            ? {
                id: "submission",
                challenge_id: "challenge",
                is_locked: true,
                fields: { repo: "https://github.com/source/project" },
                repo_snapshots: snapshots,
              }
            : {
                submission_fields: [
                  { key: "repo", type: "repo", repoAccess: "public" },
                ],
                entire_required: !!opts.entire,
                invite_jury_to_forks: !!opts.jury,
                code_review_enabled: true,
              },
      });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === "jury_assignments" ? [{ user_id: "jury" }] : table === "profiles" ? [{ email: "juror@example.invalid", github_username: null }, { email: "other@example.invalid", github_username: "test-juror" }] : [], error: null });
      return b;
    },
  } as unknown as SupabaseClient;
  let copied = false;
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input))
        .pathname;
      if (path === "/user") return Response.json({ id: identity });
      if (path === "/search/users") return Response.json({ items: [] });
      if (path.endsWith("/collaborators/test-juror")) return new Response(null, { status: 204 });
      if (opts.limited)
        return Response.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "retry-after": "120" },
          },
        );
      if (path === "/repos/source/project")
        return opts.sourceUnavailable ? new Response(null, { status: 404 }) : Response.json({
          id: opts.sourceId ?? 42,
          private: false,
          default_branch: "main",
        });
      if (path.endsWith("/git/ref/heads/main"))
        return Response.json({ object: { sha: opts.sourceSha ?? sha } });
      if (path.endsWith("/git/matching-refs/"))
        return Response.json(
          Array.from({ length: 334 }, (_, i) => ({
            ref: `refs/entire/checkpoints/aa/${i}`,
            object: { sha: opts.sourceSha ?? sha },
          })),
        );
      if (path.endsWith("/forks") && init?.method === "POST")
        return Response.json(
          { html_url: "https://github.com/snapshots/copy" },
          { status: 202 },
        );
      if (path === "/repos/snapshots/submission-submission-42")
        return new Response(null, { status: 404 });
      if (path === "/repos/snapshots/copy")
        return opts.forkStatus ? new Response(null, { status: opts.forkStatus })
          : Response.json({ parent: { id: 42, full_name: "source/project" } });
      if (path.endsWith("/git/ref/heads/ehl-final/1") && copied)
        return Response.json({ object: { sha } });
      throw new Error(`Unexpected request ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const transfer = vi.fn(async (_copy: RepositoryCapture, _heartbeat: () => Promise<void>) => {
    copied = true;
  });
  const worker = new SnapshotWorker(
    db,
    `test-token-${identity}`,
    "snapshots",
    transfer,
  );
  return {
    worker,
    rpc,
    patches,
    transfer,
    fetcher,
    update,
    db,
    token: `test-token-${identity}`,
    job,
    selection,
    snapshots,
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("copies the repository and publishes only the verified SHA", async () => {
  const s = setup();
  await s.worker.runOne();
  expect(s.transfer).toHaveBeenCalledTimes(1);
  expect(s.patches.at(-1)).toEqual(
    expect.objectContaining({
      p_status: "done",
      p_fork: "https://github.com/snapshots/copy",
      p_sha: sha,
    }),
  );
  expect(
    s.fetcher.mock.calls.some(([url]) => String(url).includes("matching-refs")),
  ).toBe(false);
});
it("copies all 334 required checkpoint refs through one Git transfer", async () => {
  const s = setup({ entire: true });
  await s.worker.runOne();
  expect(s.transfer.mock.calls).toHaveLength(1);
  expect(s.patches.at(-1)?.p_status).toBe("done");
  const step = s.patches.at(-1)?.p_step as Record<
    string,
    { checkpoint_manifest: unknown[] }
  >;
  expect(step.repo.checkpoint_manifest).toHaveLength(334);
});
it("copies the accepted commit and checkpoint manifest even after the source advances", async () => {
  const s = setup({ entire: true, sourceSha: "b".repeat(40) });
  await s.worker.runOne();
  expect(s.transfer).toHaveBeenCalledWith({
    ...s.selection, fork_url: "https://github.com/snapshots/copy", revision: 1,
    complete: true,
  }, expect.any(Function));
  expect(s.patches.at(-1)?.p_sha).toBe(sha);
  expect(s.fetcher.mock.calls.some(([url]) => /git\/ref\/heads\/main|matching-refs|repository_invitations/.test(String(url)))).toBe(false);
});
it("fails visibly without contacting GitHub when no accepted repository version exists", async () => {
  const s = setup({ missingSelection: true });
  await s.worker.runOne();
  expect(s.transfer).not.toHaveBeenCalled();
  expect(s.fetcher).not.toHaveBeenCalled();
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({
    p_status: "failed", p_error: "No accepted repository version is available for this submission",
  }));
});
it.each([
  { frozen_sha: "b".repeat(40) },
  { repository_id: 43 },
  { repo_url: "https://github.com/source/different" },
  { entire_required: true },
  { checkpoint_manifest: [{ ref: "refs/entire/checkpoints/aa/one", sha: "b".repeat(40) }] },
  { revision: 2 },
])("refuses saved copy progress that conflicts with the accepted selection: %j", async (changed) => {
  const s = setup();
  s.job.step.repo = {
    ...s.selection, fork_url: "https://github.com/snapshots/copy", revision: 1,
    complete: true, ...changed,
  };
  await s.worker.runOne();
  expect(s.transfer).not.toHaveBeenCalled();
  expect(s.fetcher).not.toHaveBeenCalled();
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({
    p_status: "failed", p_error: "Saved copy does not match the accepted repository version",
  }));
});
it("does not accept invitations or select different code when source access is lost", async () => {
  const s = setup({ sourceUnavailable: true });
  await s.worker.runOne();
  expect(s.transfer).not.toHaveBeenCalled();
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({
    p_status: "failed", p_error: "Repository is not accessible to the bot",
  }));
  expect(s.fetcher.mock.calls.some(([url]) => /repository_invitations|git\/ref|matching-refs/.test(String(url)))).toBe(false);
});
it("refuses a repository recreated under the accepted URL with a different identity", async () => {
  const s = setup({ sourceId: 43 });
  await s.worker.runOne();
  expect(s.transfer).not.toHaveBeenCalled();
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({
    p_status: "failed", p_error: "Repository identity no longer matches the accepted submission",
  }));
  expect(s.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
it("preserves the saved job and honors rate-limit retry headers without consuming attempts", async () => {
  const s = setup({ limited: true });
  await s.worker.runOne();
  expect(s.transfer).not.toHaveBeenCalled();
  expect(s.patches.at(-1)).toEqual(
    expect.objectContaining({
      p_status: "queued",
      p_delay: 120,
      p_failure: false,
      p_error: "API rate limit exceeded",
    }),
  );
  expect(s.update).toHaveBeenCalledWith(
    expect.objectContaining({ remaining: 0, pause_until: expect.any(String) }),
  );
});
it("caps repeated transfer failures instead of retrying forever", async () => {
  const s = setup({ failures: 4 });
  s.transfer.mockRejectedValue(new Error("connection reset"));
  await s.worker.runOne();
  expect(s.patches.at(-1)).toEqual(
    expect.objectContaining({ p_status: "failed", p_failure: true }),
  );
});
it("does not send a repository request when the persisted budget is paused", async () => {
  const s = setup();
  s.rpc.mockImplementation(async (name) => ({
    data: name === "reserve_snapshot_request" ? 300 : true,
    error: null,
  }));
  await expect(
    new SnapshotGitHub(s.db, s.token).request("/repos/source/project"),
  ).rejects.toMatchObject({ kind: "rate_limit", retrySeconds: 300 });
  expect(
    s.fetcher.mock.calls.filter(([url]) => !String(url).endsWith("/user")),
  ).toHaveLength(0);
});
it("makes no GitHub calls or credential lookup when there are no due copies", async () => {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.or = async () => ({ count: 0, error: null });
  const db = { from: vi.fn(() => b), rpc: vi.fn() };
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await dispatchPendingSnapshots(db as unknown as SupabaseClient);
  expect(request).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
  expect(db.from).toHaveBeenCalledTimes(1);
});
it("retries a quota rejection during initial bot identification", async () => {
  const s = setup();
  s.fetcher.mockImplementation(async () =>
    Response.json(
      { message: "API rate limit exceeded" },
      {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "retry-after": "120" },
      },
    ),
  );
  await s.worker.runOne();
  expect(s.patches.at(-1)).toEqual(
    expect.objectContaining({
      p_status: "queued",
      p_delay: 120,
      p_failure: false,
    }),
  );
  expect(s.transfer).not.toHaveBeenCalled();
});

it("does not dispatch another workflow while the snapshot worker is active", async () => {
  const queue = { select: () => ({ or: async () => ({ count: 1, error: null }) }) };
  const active: Record<string, unknown> = {};
  for (const key of ["select", "eq", "gt"]) active[key] = () => active;
  active.maybeSingle = async () => ({ data: { key: "snapshot:worker" }, error: null });
  const db = { from: vi.fn((table: string) => table === "submission_snapshot_jobs" ? queue : active), rpc: vi.fn() };
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  await dispatchPendingSnapshots(db as unknown as SupabaseClient);
  expect(request).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
});

it("keeps copied code available when one juror lacks a username and still invites the others", async () => {
  const s = setup({ jury: true });
  await s.worker.runOne();
  expect(s.patches.some(patch => patch.p_fork === "https://github.com/snapshots/copy" && patch.p_sha === sha)).toBe(true);
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({ p_status: "failed", p_error: "A juror needs a GitHub username" }));
  expect(s.fetcher.mock.calls.some(([url,init]) => String(url).endsWith("/collaborators/test-juror") && init?.method === "PUT")).toBe(true);
});

it("abandons a lost lease without a second update or stopping the worker loop", async () => {
  const s = setup();
  const original = s.rpc.getMockImplementation()!;
  s.rpc.mockImplementation(async (name, args) => name === "update_submission_snapshot"
    ? { data: false, error: null } : original(name, args));
  await expect(s.worker.runOne()).resolves.toBe(true);
  expect(s.rpc.mock.calls.filter(([name]) => name === "update_submission_snapshot")).toHaveLength(1);
  expect(s.transfer).not.toHaveBeenCalled();
  expect(s.patches).toEqual([]);
  expect(s.fetcher.mock.calls.map(([url]) => String(url))).toEqual(["https://api.github.com/user"]);
});

it("abandons the job when its lease is lost while reporting a failure", async () => {
  const s = setup({ sourceUnavailable: true });
  const original = s.rpc.getMockImplementation()!;
  s.rpc.mockImplementation(async (name, args) => name === "update_submission_snapshot" && args.p_status === "failed"
    ? { data: false, error: null } : original(name, args));
  await expect(s.worker.runOne()).resolves.toBe(true);
  expect(s.rpc.mock.calls.filter(([name, args]) => name === "update_submission_snapshot" && args.p_status === "failed")).toHaveLength(1);
  expect(s.patches.every(patch => patch.p_status === "running")).toBe(true);
  expect(s.transfer).not.toHaveBeenCalled();
});

it.each([false, true])("records a visible failure after discarding incompatible progress, missing selection: %s", async (missingSelection) => {
  const s = setup({ entire: true, missingSelection });
  const accepted = structuredClone(s.selection);
  s.job.step.repo = {
    ...s.selection, frozen_sha: "b".repeat(40),
    fork_url: "https://github.com/snapshots/copy", revision: 1, complete: true,
  };
  const original = s.rpc.getMockImplementation()!;
  s.rpc.mockImplementation(async (name, args) => {
    if (name === "update_submission_snapshot") {
      // Match SQL72: progress must contain only accepted source inputs.
      for (const [key, value] of Object.entries(args.p_step as Record<string, Record<string, unknown>>)) {
        const { fork_url, revision, complete, invited, ...selection } = value;
        if (missingSelection || key !== "repo" || JSON.stringify(selection) !== JSON.stringify(accepted))
          return { data: null, error: { message: "Copy inputs differ from the accepted submission." } };
      }
    }
    return original(name, args);
  });
  await expect(s.worker.runOne()).resolves.toBe(true);
  expect(s.patches).toHaveLength(1);
  expect(s.patches[0]).toEqual(expect.objectContaining({
    p_status: "failed", p_step: {}, p_failure: true,
    p_error: missingSelection ? "No accepted repository version is available for this submission"
      : "Saved copy does not match the accepted repository version",
  }));
  expect(s.selection).toEqual(accepted);
  expect(s.fetcher).not.toHaveBeenCalled();
  expect(s.transfer).not.toHaveBeenCalled();
});

it.each([
  { forkStatus: 404 as const, failures: 0, status: "queued" },
  { forkStatus: 202 as const, failures: 0, status: "queued" },
  { forkStatus: 404 as const, failures: 4, status: "failed" },
  { forkStatus: 202 as const, failures: 4, status: "failed" },
])("bounds pending fork creation retries: %j", async ({ forkStatus, failures, status }) => {
  const s = setup({ forkStatus, failures });
  await s.worker.runOne();
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({
    p_status: status, p_failure: true, p_delay: 15, p_error: "Fork creation is pending",
  }));
  expect(s.job.step.repo.frozen_sha).toBe(sha);
  expect(s.transfer).not.toHaveBeenCalled();
});

it.each([false, true])("fails permanently when an established fork is missing, completed: %s", async (complete) => {
  const s = setup({ forkStatus: 404 });
  s.job.step.repo = { ...s.selection, fork_url: "https://github.com/snapshots/copy", revision: 1, complete };
  await s.worker.runOne();
  expect(s.patches.at(-1)).toEqual(expect.objectContaining({
    p_status: "failed", p_failure: true, p_error: "Snapshot repository is no longer accessible",
  }));
  expect(s.job.step.repo).toEqual({ ...s.selection, fork_url: "https://github.com/snapshots/copy", revision: 1, complete });
  expect(s.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  expect(s.transfer).not.toHaveBeenCalled();
});

it("remembers that a fork exists before transfer so a later missing fork is not treated as creation", async () => {
  const s = setup();
  s.transfer.mockRejectedValue(new Error("connection reset"));
  await s.worker.runOne();
  expect(s.patches.at(-1)?.p_status).toBe("queued");
  expect(s.job.step.repo.complete).toBe(false);
  expect(s.patches.some(patch => (patch.p_step as Record<string, { complete?: boolean }>).repo?.complete === false)).toBe(true);
});

it.each(["later entry", "unexpected input"])("validates all saved progress before a heartbeat: %s", async (scenario) => {
  const s = setup();
  const accepted = structuredClone(s.snapshots);
  if (scenario === "later entry") {
    s.snapshots.second = { ...s.selection, repo_url: "https://github.com/source/second" };
    s.job.step.second = { ...s.snapshots.second, frozen_sha: "b".repeat(40), fork_url: "https://github.com/snapshots/second", revision: 1 };
  } else {
    s.job.step.repo = Object.assign({ ...s.selection, fork_url: "https://github.com/snapshots/copy", revision: 1 }, { unexpected_input: true });
  }
  const original = s.rpc.getMockImplementation()!;
  s.rpc.mockImplementation(async (name, args) => {
    if (name === "update_submission_snapshot" && Object.keys(args.p_step as object).length)
      return { data: null, error: { message: "Copy inputs differ from the accepted submission." } };
    return original(name, args);
  });
  await expect(s.worker.runOne()).resolves.toBe(true);
  expect(s.patches).toHaveLength(1);
  expect(s.patches[0]).toEqual(expect.objectContaining({
    p_status: "failed", p_step: {}, p_error: "Saved copy does not match the accepted repository version",
  }));
  expect(s.selection).toEqual(accepted.repo);
  expect(s.fetcher).not.toHaveBeenCalled();
  expect(s.transfer).not.toHaveBeenCalled();
});
