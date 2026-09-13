import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A failed repository snapshot must NEVER fail the submission.
 *
 * submitProject commits the submission row BEFORE forking the repo. Returning
 * an error after that commit told teams their submission had failed when it was
 * already saved, so they retried, spending more of the very GitHub rate limit
 * that caused the failure. These tests pin the contract: the row is saved, the
 * caller gets success, and a warning carries the caveat.
 */
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAdminClient: vi.fn(),
  snapshotRepo: vi.fn(),
  fetchCheckpointBranchIntoFork: vi.fn(),
  logEvent: vi.fn(),
  revalidatePath: vi.fn(),
  upsert: vi.fn(),
  checkCheckpointBranch: vi.fn(),
  entireGateErrorMessage: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/queries/checkin", () => ({ getCheckinStatusForUsers: vi.fn() }));
vi.mock("@/lib/entire", () => ({
  checkCheckpointBranch: mocks.checkCheckpointBranch,
  entireGateErrorMessage: mocks.entireGateErrorMessage,
}));
vi.mock("@/lib/github", () => ({
  parseGitHubRepo: (url: string) => {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    return m ? { owner: m[1], repo: m[2] } : null;
  },
  snapshotRepo: mocks.snapshotRepo,
  fetchCheckpointBranchIntoFork: mocks.fetchCheckpointBranchIntoFork,
}));

import { submitProject } from "@/lib/actions/submissions";
import { SNAPSHOT_WARNING } from "@/lib/snapshot-status";

const REPO_FIELD = [{ key: "repo", label: "Repository", type: "repo", required: true }];

/**
 * Routes each read to a canned row by table + selected columns, so the long
 * gate sequence in submitProject reaches the snapshot step.
 */
function adminClient(entireRequired = false) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      let selectCols = "";
      b.select = (cols: string) => {
        selectCols = cols ?? "";
        return b;
      };
      b.eq = () => b;
      b.is = () => b;
      b.in = () => b;
      b.update = () => b;
      b.upsert = (payload: unknown) => {
        mocks.upsert(table, payload);
        return { then: (onF: (v: unknown) => unknown) => onF({ error: null }) };
      };
      b.single = async () => {
        if (table === "team_members") return { data: { team_id: "team-1" } };
        if (table === "profiles") return { data: { email: "hacker@example.com" } };
        if (table === "applications") return { data: { status: "checked_in" } };
        if (table === "challenge_registrations") return { data: { id: "reg-1" } };
        if (table === "submissions") return { data: { is_locked: false } };
        if (table === "teams") return { data: { name: "Team One" } };
        if (table === "chapters") return { data: { submission_deadline: null, slug: "zurich" } };
        if (table === "challenges") {
          if (selectCols.includes("entire_required")) {
            return { data: { entire_required: entireRequired, submission_fields: REPO_FIELD } };
          }
          if (selectCols.includes("submission_fields")) {
            return { data: { submission_fields: REPO_FIELD, chapter_id: "chapter-1" } };
          }
          return { data: { chapter_id: "chapter-1" } };
        }
        return { data: null };
      };
      (b as { then: unknown }).then = (onF: (v: unknown) => unknown) =>
        onF({ data: [], error: null });
      return b;
    },
  };
}

function form() {
  const fd = new FormData();
  fd.set("challengeId", "challenge-1");
  fd.set("teamId", "team-1");
  fd.set("projectName", "Project One");
  fd.set("fields", JSON.stringify({ repo: "https://github.com/acme/app" }));
  fd.set("techStack", JSON.stringify(["Next.js"]));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.createAdminClient.mockReturnValue(adminClient());
  mocks.fetchCheckpointBranchIntoFork.mockResolvedValue(null);
});

describe("submitProject snapshot failures", () => {
  it("succeeds with a warning when the fork is refused (rate limit)", async () => {
    mocks.snapshotRepo.mockResolvedValue({
      error: "Could not fork repository (403): secondary rate limit",
    });

    const result = await submitProject(form());

    expect(result).toEqual({ success: true, warning: SNAPSHOT_WARNING });
    expect(result).not.toHaveProperty("error");
  });

  it("still persists the submission row when the fork is refused", async () => {
    mocks.snapshotRepo.mockResolvedValue({ error: "Could not fork repository (401)" });

    await submitProject(form());

    // The row is the thing that must survive a GitHub outage.
    expect(mocks.upsert).toHaveBeenCalledWith(
      "submissions",
      expect.objectContaining({ project_name: "Project One", team_id: "team-1" })
    );
  });

  it("succeeds with a warning when the snapshot step throws", async () => {
    mocks.snapshotRepo.mockRejectedValue(new Error("socket hang up"));

    const result = await submitProject(form());

    expect(result).toEqual({ success: true, warning: SNAPSHOT_WARNING });
  });

  it("returns a clean success with no warning when the fork works", async () => {
    mocks.snapshotRepo.mockResolvedValue({
      snapshotUrl: "https://github.com/ehl-org/zurich-team-one",
    });

    const result = await submitProject(form());

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("warning");
  });

  it("does not block on a failed Entire checkpoint capture", async () => {
    mocks.snapshotRepo.mockResolvedValue({
      snapshotUrl: "https://github.com/ehl-org/zurich-team-one",
    });
    mocks.fetchCheckpointBranchIntoFork.mockRejectedValue(new Error("no checkpoint branch"));

    const result = await submitProject(form());

    expect(result).toEqual({ success: true });
  });
});

describe("submitProject gates still block before the row is written", () => {
  it("rejects a user who is not a member of the team", async () => {
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.single = async () => ({ data: null });
        return b;
      },
    });

    const result = await submitProject(form());

    expect(result).toEqual({ error: "You are not a member of this team." });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  // A blocked attempt writes no submissions row, so the audit entry is the ONLY
  // trace it happened. Without it a stuck team is invisible to organizers.
  it("records the blocked attempt so organizers can see stuck teams", async () => {
    mocks.createAdminClient.mockReturnValue({
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.single = async () => ({ data: null });
        return b;
      },
    });

    await submitProject(form());

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submission.blocked",
        entityType: "submission",
        entityId: "challenge-1",
        actorId: "user-1",
        actorType: "participant",
        delta: { blocked: { reason: "not_team_member", team_id: "team-1" } },
      })
    );
  });

  it("logs nothing for an unauthenticated caller (no actor to attribute)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    await submitProject(form());

    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const result = await submitProject(form());

    expect(result).toEqual({ error: "Not authenticated." });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});


// The Entire gate runs on the SAME GitHub credentials as everything else, so it
// can fail for reasons the team cannot act on. Which reason is recorded decides
// whether an organizer sees a queue of teams to talk to or an incident of their
// own, so the mapping is pinned here.
describe("submitProject Entire gate attribution", () => {
  beforeEach(() => {
    mocks.createAdminClient.mockReturnValue(adminClient(true));
    mocks.entireGateErrorMessage.mockReturnValue("gate message");
  });

  const CHECK_BASE = {
    branchExists: false,
    promptCount: 0,
    checkpointCount: 0,
    resolvedRef: null,
    repoUnreadable: false,
    checkUnavailable: false,
    satisfiesGate: false,
    notes: [],
  };

  it("records OUR failure when the check could not be completed", async () => {
    mocks.checkCheckpointBranch.mockResolvedValue({ ...CHECK_BASE, checkUnavailable: true });

    const result = await submitProject(form());

    expect(result).toEqual({ error: "gate message" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submission.blocked",
        delta: { blocked: { reason: "entire_check_unavailable", team_id: "team-1" } },
      })
    );
  });

  it("records THEIR access problem when the repo is unreadable", async () => {
    mocks.checkCheckpointBranch.mockResolvedValue({ ...CHECK_BASE, repoUnreadable: true });

    await submitProject(form());

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: { blocked: { reason: "entire_repo_unreadable", team_id: "team-1" } },
      })
    );
  });

  it("records a genuinely missing record as theirs", async () => {
    mocks.checkCheckpointBranch.mockResolvedValue({ ...CHECK_BASE });

    await submitProject(form());

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: { blocked: { reason: "entire_missing", team_id: "team-1" } },
      })
    );
  });

  it("does not block or log when the gate passes", async () => {
    mocks.checkCheckpointBranch.mockResolvedValue({ ...CHECK_BASE, satisfiesGate: true });
    mocks.snapshotRepo.mockResolvedValue({ snapshotUrl: "https://github.com/ehl-org/x" });

    const result = await submitProject(form());

    expect(result).toEqual({ success: true });
    expect(mocks.logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "submission.blocked" })
    );
  });
});
