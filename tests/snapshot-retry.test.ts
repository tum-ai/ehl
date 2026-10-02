import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks }));
import {
  lockSubmissionsCore,
  retrySnapshotsCore,
} from "@/lib/submissions-lock";
function rows(data: unknown[], error: unknown = null) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "is", "or", "in"]) b[k] = () => b;
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data, error });
  return b;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
it("locks receipts and queues their final copies without calling GitHub", async () => {
  expect(await lockSubmissionsCore("challenge")).toEqual({
    success: true,
    failedJuryInvites: [],
    failedSnapshots: [],
  });
  expect(mocks.rpc).toHaveBeenCalledWith("lock_submission_receipts", {
    p_challenge: "challenge",
  });
  expect(mocks.from).not.toHaveBeenCalled();
});
it("does not claim a successful lock on a database failure", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "unavailable" } });
  expect(await lockSubmissionsCore("challenge")).toEqual({
    error: "unavailable",
  });
});
it("queues a missing copy without claiming it was already copied", async () => {
  mocks.from.mockReturnValue(
    rows([
      {
        id: "submission",
        fields: { repo: "https://github.com/example/project" },
      },
    ]),
  );
  expect(await retrySnapshotsCore({ submissionId: "submission" })).toEqual({
    attempted: 1,
    queued: 1,
    succeeded: 0,
    failures: [],
  });
  expect(mocks.rpc).toHaveBeenCalledWith("retry_submission_snapshot", {
    p_id: "submission",
  });
});
it("reports a retry enqueue failure and continues with other submissions", async () => {
  mocks.from.mockImplementation((table: string) =>
    rows(
      table === "challenges"
        ? [{ id: "challenge" }]
        : ["one", "two"].map((id) => ({
            id,
            fields: { repo: "https://github.com/example/project" },
          })),
    ),
  );
  mocks.rpc
    .mockResolvedValueOnce({ error: { message: "database unavailable" } })
    .mockResolvedValueOnce({ error: null });
  expect(await retrySnapshotsCore({ chapterId: "chapter" })).toEqual({
    attempted: 2,
    queued: 1,
    succeeded: 0,
    failures: ["one: database unavailable"],
  });
});
it("leaves submissions without repositories out of the retry worklist", async () => {
  mocks.from.mockReturnValue(
    rows([{ id: "submission", fields: { deck: "not-a-repository" } }]),
  );
  expect(await retrySnapshotsCore({ submissionId: "submission" })).toEqual({
    attempted: 0,
    queued: 0,
    succeeded: 0,
    failures: [],
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
