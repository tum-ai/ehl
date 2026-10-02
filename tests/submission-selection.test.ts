import { describe, expect, it } from "vitest";
import { toSubmission } from "@/lib/queries/mappers";
import { selectSubmissionRepository } from "@/lib/submission-snapshots/selection";
import type { SubmissionFieldConfig } from "@/lib/types";

const sha = "a".repeat(40);
const secondSha = "b".repeat(40);
const fields: SubmissionFieldConfig[] = [
  { key: "backend", label: "Backend", type: "repo", required: true },
  { key: "frontend", label: "Frontend", type: "repo", required: true },
];
const selection = {
  repo_url: "https://github.com/team/backend", repository_id: 1,
  frozen_sha: sha, entire_required: true,
  checkpoint_manifest: [{ ref: "refs/heads/entire/checkpoints/v1", sha: secondSha }],
};
function submission(overrides: Record<string, unknown> = {}) {
  return toSubmission({
    id: "submission", challenge_id: "challenge", team_id: "team",
    fields: { backend: selection.repo_url, frontend: "https://github.com/team/frontend" },
    submission_revision: 1,
    repo_snapshots: {
      backend: selection,
      frontend: { ...selection, repo_url: "https://github.com/team/frontend", repository_id: 2, frozen_sha: secondSha },
    },
    ...overrides,
  });
}

describe("accepted submission repository selection", () => {
  it("maps the accepted objects and receipt revision for every consumer", () => {
    const mapped = submission();
    expect(mapped.submissionRevision).toBe(1);
    expect(mapped.repoSnapshots?.backend).toEqual(selection);
  });

  it("pins the source link and reviews before the background copy completes", () => {
    const result = selectSubmissionRepository(submission(), fields);
    expect(result).toEqual({
      repoUrl: selection.repo_url, commitSha: sha, checkpointRefs: selection.checkpoint_manifest,
      href: `${selection.repo_url}/tree/${sha}`, missingFork: true,
    });
  });

  it("uses the matching copied commit for the primary repository", () => {
    const result = selectSubmissionRepository(submission({ fork_url: "https://github.com/snapshots/copy", snapshot_sha: sha }), fields);
    expect(result?.repoUrl).toBe("https://github.com/snapshots/copy");
    expect(result?.href).toBe(`https://github.com/snapshots/copy/tree/${sha}`);
    expect(result?.commitSha).toBe(sha);
    expect(result?.checkpointRefs).toEqual(selection.checkpoint_manifest);
    expect(result?.missingFork).toBe(false);
  });

  it("never applies the primary fork to a different repository field", () => {
    const result = selectSubmissionRepository(submission({ fork_url: "https://github.com/snapshots/copy", snapshot_sha: sha }), fields, "frontend");
    expect(result?.repoUrl).toBe("https://github.com/team/frontend");
    expect(result?.href).toBe(`https://github.com/team/frontend/tree/${secondSha}`);
    expect(result?.missingFork).toBe(true);
  });

  it("ignores a copied commit that does not match the accepted selection", () => {
    const result = selectSubmissionRepository(submission({ fork_url: "https://github.com/snapshots/copy", snapshot_sha: "f".repeat(40) }), fields);
    expect(result?.repoUrl).toBe(selection.repo_url);
    expect(result?.commitSha).toBe(sha);
    expect(result?.href).toBe(`${selection.repo_url}/tree/${sha}`);
  });

  it.each([
    {},
    { backend: { ...selection, frozen_sha: null } },
    { backend: { ...selection, checkpoint_manifest: undefined } },
    { backend: { ...selection, repo_url: "https://github.com/other/repo" } },
  ])("refuses incomplete or mismatched new receipts without a mutable fallback", (repo_snapshots) => {
    expect(selectSubmissionRepository(submission({ repo_snapshots }), fields)).toBeNull();
  });

  it("preserves historical fallback only for legacy submissions", () => {
    const legacy = submission({ submission_revision: 0, repo_snapshots: {}, fork_url: null });
    expect(selectSubmissionRepository(legacy, fields)?.href).toBe(selection.repo_url);
    expect(selectSubmissionRepository(legacy, fields)?.commitSha).toBeUndefined();
    expect(selectSubmissionRepository(legacy, fields)?.checkpointRefs).toBeUndefined();
  });
});
