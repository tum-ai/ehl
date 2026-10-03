import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), createAdminClient: vi.fn(), runPipeline: vi.fn() }));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/code-review/pipeline", () => ({ runCodeReviewPipeline: mocks.runPipeline }));
vi.mock("@/lib/gdrive", () => ({ downloadFile: vi.fn() }));

import { POST } from "@/app/api/code-review/route";

const sha = "a".repeat(40);
const manifest = [{ ref: "refs/heads/entire/checkpoints/v1", sha: "b".repeat(40) }];
function fixture() {
  const submission = {
    id: "submission", challenge_id: "challenge", submission_revision: 1,
    fields: { repo: "https://github.com/team/project" }, fork_url: null, snapshot_sha: null,
    repo_snapshots: { repo: { repo_url: "https://github.com/team/project", repository_id: 1,
      frozen_sha: sha, entire_required: true, checkpoint_manifest: manifest } },
  };
  const state = { submission, row: { id: "review-original", status: "queued" }, insertedId: "", upserts: 0,
    updates: [] as Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }> };
  const client = {
    from(table: string) {
      let values: Record<string, unknown> | null = null;
      let upsert = false;
      const filters: Array<[string, unknown]> = [];
      const execute = async () => {
        if (table === "submissions") return { data: state.submission, error: null };
        if (table === "challenges") return { data: { id: "challenge", entire_required: true,
          submission_fields: [{ key: "repo", type: "repo", label: "Code", required: true }] }, error: null };
        if (table !== "code_reviews") throw new Error(`Unexpected table ${table}`);
        if (upsert) {
          state.upserts++;
          state.row = { id: String(values?.id ?? "review-original"), status: "processing" };
          state.insertedId = state.row.id;
          return { data: { id: state.row.id }, error: null };
        }
        if (values) {
          state.updates.push({ values, filters: [...filters] });
          if (filters.some(([column, value]) => column === "id" && value !== state.row.id)) return { data: null, error: null };
          if (typeof values.status === "string") state.row.status = values.status;
          return { data: { id: state.row.id }, error: null };
        }
        return { data: { id: state.row.id }, error: null };
      };
      const query = {
        select: (_columns?: string) => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        upsert: (payload: Record<string, unknown>) => { values = payload; upsert = true; return query; },
        update: (payload: Record<string, unknown>) => { values = payload; return query; },
        single: execute, maybeSingle: execute,
        then: (resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown) => execute().then(resolve),
      };
      return query;
    },
  };
  mocks.createAdminClient.mockReturnValue(client);
  return state;
}
const request = () => new Request("http://localhost/api/code-review", {
  method: "POST", body: JSON.stringify({ submissionId: "submission" }),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "admin" }, profile: { role: "admin" } });
  mocks.runPipeline.mockResolvedValue({ reviewContent: {}, repoMetadata: {}, pipelineLog: {}, costUsd: 0 });
});

describe("manual review of accepted receipts", () => {
  it("passes only the accepted commit and checkpoint manifest to the pipeline", async () => {
    const state = fixture();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.runPipeline.mock.calls[0][0]).toMatchObject({
      repoUrl: "https://github.com/team/project", commitSha: sha, checkpointRefs: manifest,
    });
    expect(state.updates.at(-1)?.filters).toEqual([["id", state.insertedId]]);
  });

  it("does not review mutable source code when a new receipt has no accepted selection", async () => {
    const state = fixture();
    state.submission.repo_snapshots = {} as typeof state.submission.repo_snapshots;
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(state.upserts).toBe(0);
    expect(mocks.runPipeline).not.toHaveBeenCalled();
  });

  it("cannot overwrite a replacement review after the submission changes", async () => {
    const state = fixture();
    mocks.runPipeline.mockImplementationOnce(async () => {
      state.submission.submission_revision = 2;
      state.row = { id: "replacement-review", status: "queued" };
      return { reviewContent: {}, repoMetadata: {}, pipelineLog: {}, costUsd: 0 };
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(state.row).toEqual({ id: "replacement-review", status: "queued" });
    expect(state.updates.at(-1)?.filters).toEqual([["id", state.insertedId]]);
  });

  it("keeps an old pipeline failure from failing a newer review row", async () => {
    const state = fixture();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.runPipeline.mockImplementationOnce(async () => {
        state.row = { id: "replacement-review", status: "queued" };
        throw new Error("Old review failed");
      });
      expect((await POST(request())).status).toBe(500);
      expect(state.row).toEqual({ id: "replacement-review", status: "queued" });
      expect(state.updates.at(-1)?.filters).toEqual([["id", state.insertedId]]);
    } finally { errorLog.mockRestore(); }
  });
});
