import { beforeEach, expect, it, vi } from "vitest";
import { toChallenge } from "@/lib/queries/mappers";

const mocks = vi.hoisted(() => ({ ingestRepo: vi.fn(), ingestSessionHistory: vi.fn(), chatCompletion: vi.fn() }));
vi.mock("@/lib/code-review/ingest", () => ({ ingestRepo: mocks.ingestRepo }));
vi.mock("@/lib/entire", () => ({ ingestSessionHistory: mocks.ingestSessionHistory }));
vi.mock("@/lib/github", () => ({ parseGitHubRepo: () => ({ owner: "snapshots", repo: "copy" }) }));
vi.mock("@/lib/code-review/openrouter", () => ({ chatCompletion: mocks.chatCompletion }));
vi.mock("@/lib/code-review/prompts", () => Object.fromEntries([
  "buildTechDescriptionPrompt", "buildCodeQualityPrompt", "buildHighlightsPrompt", "buildOriginalityPrompt",
  "buildSessionHistoryPrompt", "buildCoordinatorPrompt",
].map(name => [name, () => ({ system: "test", user: "test" })])));

import { runCodeReviewPipeline } from "@/lib/code-review/pipeline";
const sha = "a".repeat(40);
const checkpointRefs = [{ ref: "refs/entire/checkpoints/AA/id", sha: "b".repeat(40) }];
const challenge = toChallenge({ id: "challenge", title: "Challenge", entire_required: true });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ingestRepo.mockResolvedValue({ files: [{ path: "index.ts", content: "const x = 1;" }], metadata: { frameworks_detected: [] } });
  mocks.ingestSessionHistory.mockResolvedValue(null);
  mocks.chatCompletion.mockResolvedValue({ content: "{}", usage: { prompt_tokens: 1, completion_tokens: 1, total_cost: 0 } });
});

it("reviews only the accepted code and Entire objects", async () => {
  await runCodeReviewPipeline({ repoUrl: "https://github.com/snapshots/copy", commitSha: sha, checkpointRefs, challenge, briefText: null });
  expect(mocks.ingestRepo).toHaveBeenCalledWith("https://github.com/snapshots/copy", 50000, sha);
  expect(mocks.ingestSessionHistory).toHaveBeenCalledWith("snapshots", "copy", { checkpointRefs, commitSha: sha });
});

it("passes an explicitly empty manifest rather than discovering later Entire refs", async () => {
  await runCodeReviewPipeline({ repoUrl: "https://github.com/snapshots/copy", commitSha: sha, checkpointRefs: [], challenge, briefText: null });
  expect(mocks.ingestSessionHistory).toHaveBeenCalledWith("snapshots", "copy", { checkpointRefs: [], commitSha: sha });
});
