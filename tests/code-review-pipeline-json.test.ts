import { beforeEach, expect, it, vi } from "vitest";

// Zurich: 6 of 22 reviews failed with "Unterminated string in JSON" because the
// coordinator's answer was cut off at max_tokens (3,000) and parsed unguarded.
// Production logs showed successful answers up to 2,997 of 3,000 tokens.

const mocks = vi.hoisted(() => ({ chat: vi.fn(), ingest: vi.fn() }));
vi.mock("@/lib/code-review/openrouter", () => ({ chatCompletion: mocks.chat }));
vi.mock("@/lib/code-review/ingest", () => ({ ingestRepo: mocks.ingest }));

import { runCodeReviewPipeline } from "@/lib/code-review/pipeline";

const usage = { prompt_tokens: 100, completion_tokens: 50, total_cost: 0.01 };
const validCoordinator = JSON.stringify({
  executive_summary: "Solid project.",
  scores: { code_quality: { score: 7, max: 10, weight: 10, rationale: "Clean." } },
  weighted_total: 72,
  highlights: [],
  concerns: [],
  strengths: ["Clear structure"],
  weaknesses: [],
  notable_patterns: "",
});
const cutOff = validCoordinator.slice(0, Math.floor(validCoordinator.length / 2));

const isCoordinator = (params: { messages: Array<{ content: string }> }) =>
  params.messages[0].content.includes("chief editor of a hackathon jury report");

const challenge = {
  id: "c1", chapterId: "ch1", title: "Challenge", description: "Build something",
  entireRequired: false, codeReviewConfig: null,
} as never;

function run() {
  return runCodeReviewPipeline({ repoUrl: "https://github.com/owner/repo", challenge, briefText: null });
}

beforeEach(() => {
  mocks.chat.mockReset();
  mocks.ingest.mockReset();
  mocks.ingest.mockResolvedValue({
    files: [{ path: "index.ts", content: "export const x = 1;" }],
    metadata: { languages: {}, total_loc: 1, file_count: 1, has_tests: false, has_readme: false, has_dockerfile: false, frameworks_detected: [], commit_count: 1, primary_language: "TypeScript", token_count: 10, sampled: false },
  });
});

function coordinatorAnswers(...answers: Array<{ content: string; finishReason?: string }>) {
  const queue = [...answers];
  mocks.chat.mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
    if (!isCoordinator(params)) return { content: "{}", usage, finishReason: "stop" };
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra coordinator call");
    return { content: next.content, usage, finishReason: next.finishReason ?? "stop" };
  });
}
const coordinatorCalls = () => mocks.chat.mock.calls.filter(([p]) => isCoordinator(p)).map(([p]) => p);

it("gives the coordinator room for long answers", async () => {
  coordinatorAnswers({ content: validCoordinator });
  await run();
  expect(coordinatorCalls()[0].max_tokens).toBeGreaterThanOrEqual(8000);
});

it("retries once with a higher limit when the answer was cut off, and completes", async () => {
  coordinatorAnswers({ content: cutOff, finishReason: "length" }, { content: validCoordinator });
  const result = await run();
  const calls = coordinatorCalls();
  expect(calls).toHaveLength(2);
  expect(calls[1].max_tokens).toBeGreaterThan(calls[0].max_tokens);
  expect(result.reviewContent.weighted_total).toBe(72);
  expect(result.pipelineLog.stages.coordinator).toEqual(expect.objectContaining({ status: "completed", retried: true }));
});

it("retries once when the answer is invalid JSON even without a length stop", async () => {
  coordinatorAnswers({ content: '{"executive_summary": "x", }' }, { content: validCoordinator });
  const result = await run();
  expect(coordinatorCalls()).toHaveLength(2);
  expect(result.reviewContent.executive_summary).toBe("Solid project.");
});

it("fails with a clear message when the retry is invalid too", async () => {
  coordinatorAnswers({ content: cutOff, finishReason: "length" }, { content: cutOff, finishReason: "length" });
  await expect(run()).rejects.toThrow("Coordinator returned invalid JSON after one retry");
  expect(coordinatorCalls()).toHaveLength(2);
});

it("accepts JSON wrapped in prose or a code fence without a retry", async () => {
  coordinatorAnswers({ content: "Here is the report:\n```json\n" + validCoordinator + "\n```\nThanks." });
  const result = await run();
  expect(coordinatorCalls()).toHaveLength(1);
  expect(result.reviewContent.weighted_total).toBe(72);
});

it("marks a cut-off sub-review as truncated instead of hiding it", async () => {
  mocks.chat.mockImplementation(async (params: { messages: Array<{ content: string }>; max_tokens: number }) => {
    if (isCoordinator(params)) return { content: validCoordinator, usage, finishReason: "stop" };
    return { content: '{"partial": "cut', usage, finishReason: "length" };
  });
  const result = await run();
  const subs = ["tech_description", "code_quality", "highlights_issues", "originality"];
  for (const name of subs) expect(result.pipelineLog.stages[name]).toEqual(expect.objectContaining({ truncated: true }));
});
