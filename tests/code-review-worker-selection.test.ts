import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), runPipeline: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/code-review/pipeline", () => ({ runCodeReviewPipeline: mocks.runPipeline }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("the queued review runner uses accepted objects and retains the claimed review id", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-only");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("Unexpected exit"); });
  const sha = "a".repeat(40);
  const checkpointRefs = [{ ref: "refs/entire/checkpoints/AA/id", sha: "b".repeat(40) }];
  let claimed = false;
  const updates: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  mocks.createClient.mockReturnValue({
    from(table: string) {
      let values: Record<string, unknown> | null = null;
      const filters: Array<[string, unknown]> = [];
      const execute = async () => {
        if (table === "submissions") return { data: {
          id: "submission", challenge_id: "challenge", submission_revision: 1,
          fields: { repo: "https://github.com/team/project" }, fork_url: "https://github.com/snapshots/copy", snapshot_sha: sha,
          repo_snapshots: { repo: { repo_url: "https://github.com/team/project", repository_id: 1,
            frozen_sha: sha, entire_required: true, checkpoint_manifest: checkpointRefs } },
        }, error: null };
        if (table === "challenges") return { data: { id: "challenge", entire_required: true,
          submission_fields: [{ key: "repo", label: "Code", type: "repo", required: true }] }, error: null };
        if (table !== "code_reviews") throw new Error(`Unexpected table ${table}`);
        if (values) {
          updates.push({ values, filters });
          if (values.status === "processing") claimed = true;
          return { data: { id: "claimed-review" }, error: null };
        }
        return { data: claimed ? null : { id: "claimed-review", submission_id: "submission" }, error: null };
      };
      const query = {
        select: () => query, order: () => query, limit: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        update: (payload: Record<string, unknown>) => { values = payload; return query; },
        single: execute, maybeSingle: execute,
        then: (resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown) => execute().then(resolve),
      };
      return query;
    },
  });
  mocks.runPipeline.mockImplementation(async (params) => {
    await params.onProgress("Ingested accepted version");
    return { reviewContent: {}, repoMetadata: {}, pipelineLog: {}, costUsd: 0 };
  });
  await import("../scripts/process-code-reviews");
  await vi.waitFor(() => {
    expect(updates.some(update => update.values.status === "completed")).toBe(true);
  });
  expect(mocks.runPipeline.mock.calls[0][0]).toMatchObject({
    repoUrl: "https://github.com/snapshots/copy", commitSha: sha, checkpointRefs,
  });
  for (const update of updates) expect(update.filters[0]).toEqual(["id", "claimed-review"]);
  expect(exit).not.toHaveBeenCalled();
});
