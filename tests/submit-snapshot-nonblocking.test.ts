import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Approved behavior: verify and freeze source versions before saving; copies stay asynchronous.
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  participantRpc: vi.fn(),
  admin: vi.fn(),
  log: vi.fn(),
  github: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.participantRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.log }));
vi.mock("@/lib/queries/checkin", () => ({ getCheckinStatusForUsers: vi.fn() }));
vi.mock("@/lib/github", () => ({
  parseGitHubRepo: vi.fn(),
  snapshotRepo: mocks.github,
  fetchCheckpointBranchIntoFork: mocks.github,
}));
vi.mock("@/lib/entire", () => ({
  checkCheckpointBranch: mocks.github,
  entireGateErrorMessage: vi.fn(),
}));
vi.mock("@/lib/submissions-lock", () => ({
  lockSubmissionsCore: vi.fn(),
  makeSnapshotName: vi.fn(),
  retrySnapshotsCore: vi.fn(),
}));
vi.mock("@/lib/submission-snapshots/prepare", async (original) => ({
  ...await original<typeof import("@/lib/submission-snapshots/prepare")>(),
  prepareSubmissionRepositories: mocks.prepare,
}));
vi.mock("@/lib/ratelimit", () => ({ apiLimiter: {}, checkRateLimit: async () => ({limited:false}) }));
import { SubmissionVerificationError } from "@/lib/submission-snapshots/prepare";
import { submitProject } from "@/lib/actions/submissions";

function form() {
  const f = new FormData();
  f.set("challengeId", "11111111-1111-4111-8111-111111111111");
  f.set("teamId", "22222222-2222-4222-8222-222222222222");
  f.set("projectName", "Project One");
  f.set(
    "fields",
    JSON.stringify({ repo: "https://github.com/example/project" }),
  );
  f.set("techStack", '["Next.js"]');
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "participant" } } });
  mocks.participantRpc.mockResolvedValue({data:null,error:{message:"Participant RPC must not save submissions"}});
  mocks.rpc.mockImplementation(async (name) => ({ data: name === "submission_requirements" ? {
    entire_required: true, submission_fields: [{key:"repo",type:"repo",required:true}], revision:0,
  } : "receipt", error:null }));
  mocks.prepare.mockResolvedValue({repo:{repo_url:"https://github.com/example/project",repository_id:1,
    frozen_sha:"a".repeat(40),entire_required:true,checkpoint_manifest:[{ref:"refs/entire/checkpoints/aa/bb",sha:"b".repeat(40)}]}});
  mocks.admin.mockReturnValue({rpc:mocks.rpc});
  mocks.github.mockRejectedValue(new Error("GitHub rate limit exhausted"));
  vi.stubGlobal("fetch", mocks.github);
});
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("verified submission with background copying", () => {
  it("blocks missing required Entire before recording a submission", async () => {
    mocks.prepare.mockRejectedValue(new SubmissionVerificationError("Entire missing", "entire_missing"));
    const result = await submitProject(form());
    expect(result).toHaveProperty("error");
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "receive_submission")).toHaveLength(0);
  });
  it("saves verified versions through the service RPC without copying or a signing secret", async () => {
    expect(await submitProject(form())).toEqual({ success: true });
    const args = mocks.rpc.mock.calls.find(([name]) => name === "receive_submission")![1];
    const receipt = args.p_submission;
    expect(receipt.fields).toEqual({repo:"https://github.com/example/project"});
    expect(receipt.repo_snapshots.repo.frozen_sha).toBe("a".repeat(40));
    expect(receipt.requirements.revision).toBe(0);
    expect(receipt.user_id).toBe("participant");
    expect(Object.keys(args)).toEqual(["p_submission"]);
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
    expect(mocks.github).not.toHaveBeenCalled();
    expect(mocks.admin).toHaveBeenCalledTimes(1);
    expect(mocks.participantRpc).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "submission.created" }),
    );
  });
  it.each(["entire_repo_unreadable", "entire_check_unavailable"] as const)("blocks %s before writing", async reason => {
    mocks.prepare.mockRejectedValue(new SubmissionVerificationError("Could not verify", reason));
    expect(await submitProject(form())).toEqual({error:"Could not verify"});
    expect(mocks.rpc.mock.calls.filter(([name])=>name==="receive_submission")).toHaveLength(0);
  });
  it("returns the database failure without claiming a receipt", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Database unavailable" },
    });
    expect(await submitProject(form())).toEqual({
      error: "Database unavailable",
    });
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each([
    ["not_team_member", "You are not a member of this team."],
    ["not_checked_in", "You must be checked in to submit a project."],
    ["not_registered", "Your team is not registered for this challenge."],
    ["submissions_locked", "Submissions are locked. The deadline has passed."],
    ["deadline_passed", "The submission deadline has passed."],
  ])("preserves %s rejection and its audit reason", async (reason, message) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message, details: reason },
    });
    expect(await submitProject(form())).toEqual({ error: message });
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submission.blocked",
        delta: {
          blocked: { reason, team_id: "22222222-2222-4222-8222-222222222222" },
        },
      }),
    );
    expect(mocks.github).not.toHaveBeenCalled();
  });
  it("rejects an unauthenticated caller without database writes or audit impersonation", async () => {
    mocks.user.mockResolvedValue({ data: { user: null } });
    expect(await submitProject(form())).toEqual({
      error: "Not authenticated.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["null", "[]", '{"repo":123}'])(
    "rejects malformed field values: %s",
    async (fields) => {
      const f = form();
      f.set("fields", fields);
      expect(await submitProject(f)).toEqual({
        error: "Invalid submission fields or technology stack.",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});

it("rejects a file masquerading as the short description before calling GitHub", async () => {
  const input=form(); input.set("shortDescription",new Blob(["unexpected"]),"details.txt");
  expect(await submitProject(input)).toEqual({error:"Invalid project details."});
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("normalizes repository whitespace before verification and the service save", async () => {
  const input=form(); input.set("fields",JSON.stringify({repo:"  https://github.com/example/project  "}));
  expect(await submitProject(input)).toEqual({success:true});
  expect(mocks.prepare.mock.calls[0][0]).toEqual({repo:"https://github.com/example/project"});
  const args=mocks.rpc.mock.calls.find(([name])=>name==="receive_submission")![1];
  expect(args.p_submission.fields.repo).toBe("https://github.com/example/project");
});

it("uses only the verified session identity, ignoring user IDs in form data", async () => {
  const input=form(); input.set("userId","outsider"); input.set("user_id","outsider");
  expect(await submitProject(input)).toEqual({success:true});
  expect(mocks.rpc.mock.calls[0]).toEqual(["submission_requirements",{
    p_user:"participant",p_challenge:input.get("challengeId"),p_team:input.get("teamId"),
  }]);
  expect(mocks.rpc.mock.calls.find(([name])=>name==="receive_submission")![1].p_submission.user_id).toBe("participant");
  expect(mocks.participantRpc).not.toHaveBeenCalled();
});
it("refuses failed authentication before creating the service client", async () => {
  mocks.user.mockResolvedValue({data:{user:{id:"participant"}},error:{message:"Invalid session"}});
  expect(await submitProject(form())).toEqual({error:"Not authenticated."});
  expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});
