import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * retrySnapshotsCore is the operator's recovery path: it re-forks submissions
 * left with fork_url NULL after GitHub refused the snapshot. It must report the
 * live GitHub error (so an admin knows whether to wait out a rate limit or
 * rotate the token), keep going past one bad repo, and never claim success it
 * did not achieve.
 */
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  snapshotRepo: vi.fn(),
  fetchCheckpointBranchIntoFork: vi.fn(),
  addCollaborators: vi.fn(),
  updated: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/github", () => ({
  parseGitHubRepo: (url: string) => {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    return m ? { owner: m[1], repo: m[2] } : null;
  },
  snapshotRepo: mocks.snapshotRepo,
  fetchCheckpointBranchIntoFork: mocks.fetchCheckpointBranchIntoFork,
  addCollaborators: mocks.addCollaborators,
}));

import { retrySnapshotsCore } from "@/lib/submissions-lock";

const REPO_FIELD = [{ key: "repo", label: "Repository", type: "repo", required: true }];

function adminClient(
  missing: {
    id: string;
    team_id: string;
    challenge_id: string;
    fields: Record<string, string>;
  }[]
) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.is = () => b;
      b.in = () => b;
      b.update = (patch: unknown) => {
        mocks.updated(table, patch);
        return b;
      };
      b.single = async () => {
        if (table === "challenges") {
          return { data: { submission_fields: REPO_FIELD, chapter_id: "chapter-1" } };
        }
        if (table === "teams") return { data: { name: "Team One" } };
        if (table === "chapters") return { data: { slug: "zurich" } };
        return { data: null };
      };
      (b as { then: unknown }).then = (onF: (v: unknown) => unknown) => {
        if (table === "submissions") return onF({ data: missing, error: null });
        if (table === "challenges") return onF({ data: [{ id: "challenge-1" }], error: null });
        return onF({ data: [], error: null });
      };
      return b;
    },
  };
}

const ONE = [
  { id: "sub-1", team_id: "team-1", challenge_id: "challenge-1", fields: { repo: "https://github.com/acme/app" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchCheckpointBranchIntoFork.mockResolvedValue(null);
});

describe("retrySnapshotsCore", () => {
  it("forks a submission that is missing its snapshot and records the URL", async () => {
    mocks.createAdminClient.mockReturnValue(adminClient(ONE));
    mocks.snapshotRepo.mockResolvedValue({
      snapshotUrl: "https://github.com/ehl-org/zurich-team-one",
    });

    const result = await retrySnapshotsCore({ submissionId: "sub-1" });

    expect(result).toEqual({ attempted: 1, succeeded: 1, failures: [] });
    expect(mocks.updated).toHaveBeenCalledWith("submissions", {
      fork_url: "https://github.com/ehl-org/zurich-team-one",
    });
  });

  it("reports the live GitHub error instead of a generic failure", async () => {
    mocks.createAdminClient.mockReturnValue(adminClient(ONE));
    mocks.snapshotRepo.mockResolvedValue({
      error: "Could not fork repository (403): secondary rate limit",
    });

    const result = await retrySnapshotsCore({ submissionId: "sub-1" });

    expect(result.succeeded).toBe(0);
    expect(result.attempted).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("secondary rate limit");
    expect(result.failures[0]).toContain("Team One");
    // Nothing may be written when the fork did not happen.
    expect(mocks.updated).not.toHaveBeenCalled();
  });

  it("keeps going past a failing repo instead of abandoning the rest", async () => {
    const three = [
      { id: "sub-1", team_id: "t1", challenge_id: "challenge-1", fields: { repo: "https://github.com/a/a" } },
      { id: "sub-2", team_id: "t2", challenge_id: "challenge-1", fields: { repo: "https://github.com/b/b" } },
      { id: "sub-3", team_id: "t3", challenge_id: "challenge-1", fields: { repo: "https://github.com/c/c" } },
    ];
    mocks.createAdminClient.mockReturnValue(adminClient(three));
    mocks.snapshotRepo
      .mockResolvedValueOnce({ snapshotUrl: "https://github.com/ehl-org/a" })
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ snapshotUrl: "https://github.com/ehl-org/c" });

    const result = await retrySnapshotsCore({ chapterId: "chapter-1" });

    expect(result.succeeded).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("socket hang up");
  });

  it("is a no-op when nothing is missing a snapshot", async () => {
    mocks.createAdminClient.mockReturnValue(adminClient([]));

    const result = await retrySnapshotsCore({ chapterId: "chapter-1" });

    expect(result).toEqual({ attempted: 0, succeeded: 0, failures: [] });
    expect(mocks.snapshotRepo).not.toHaveBeenCalled();
  });

  it("skips a submission whose repo URL cannot be parsed", async () => {
    mocks.createAdminClient.mockReturnValue(
      adminClient([
        { id: "sub-1", team_id: "t1", challenge_id: "challenge-1", fields: { repo: "not-a-url" } },
      ])
    );

    const result = await retrySnapshotsCore({ submissionId: "sub-1" });

    expect(result.attempted).toBe(0);
    expect(mocks.snapshotRepo).not.toHaveBeenCalled();
  });
});
