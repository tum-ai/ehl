import type {
  Challenge,
  CodeReviewConfig,
  CodeReviewContentV2,
  RepoMetadata,
  PipelineLog,
  PipelineStageLog,
  ReviewHighlight,
  ReviewConcern,
} from "@/lib/types";
import { chatCompletion } from "./openrouter";
import { ingestRepo } from "./ingest";
import { ingestSessionHistory } from "@/lib/entire";
import { parseGitHubRepo } from "@/lib/github";
import type { SessionHistoryAnalysis } from "@/lib/types";
import type { CheckpointRef } from "@/lib/submission-snapshots/types";
import {
  buildTechDescriptionPrompt,
  buildCodeQualityPrompt,
  buildHighlightsPrompt,
  buildOriginalityPrompt,
  buildSessionHistoryPrompt,
  buildCoordinatorPrompt,
} from "./prompts";

const DEFAULT_CONFIG: CodeReviewConfig = {
  models: {
    // Model IDs must be CURRENT OpenRouter IDs — a stale id (e.g. a dated
    // anthropic snapshot or an old gemini -001) makes OpenRouter 400 "not a valid
    // model ID" and the whole review fails. The admin Code-Reviews page also lets
    // an operator override these per challenge from the LIVE model list.
    tech_description: "google/gemini-2.5-flash",
    code_quality: "anthropic/claude-sonnet-4.5",
    highlights_issues: "anthropic/claude-sonnet-4.5",
    originality: "google/gemini-2.5-flash",
    coordinator: "anthropic/claude-sonnet-4.5",
  },
  weights: {
    code_quality: 30,
    architecture: 25,
    challenge_alignment: 25,
    innovation: 20,
  },
  language: "en",
  token_budget: 50000,
};

function mergeConfig(config: CodeReviewConfig | null): CodeReviewConfig {
  if (!config) return DEFAULT_CONFIG;
  return {
    models: { ...DEFAULT_CONFIG.models, ...config.models },
    weights: { ...DEFAULT_CONFIG.weights, ...config.weights },
    language: config.language || DEFAULT_CONFIG.language,
    token_budget: config.token_budget || DEFAULT_CONFIG.token_budget,
  };
}

// Output caps (max_tokens) per stage. Answers are billed by tokens produced, so a
// higher cap only costs more when a model actually needs it. Zurich's coordinator
// answers reached 2,997 of the former 3,000 and were cut off mid-string.
const OUTPUT_TOKENS = {
  tech_description: 3000,
  code_quality: 6000,
  highlights_issues: 6000,
  originality: 3000,
  session_history: 4000,
  coordinator: 8000,
  coordinator_retry: 16000,
} as const;

function parseJson(text: string): unknown {
  // Strip markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Tolerate prose or a code fence around the object; still reject broken JSON.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw error;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

interface SubReviewerResult {
  content: string;
  finishReason: string | null;
  usage: { prompt_tokens: number; completion_tokens: number; total_cost: number };
  duration_ms: number;
}

async function runSubReviewer(
  model: string,
  prompt: { system: string; user: string },
  maxTokens: number
): Promise<SubReviewerResult> {
  const start = Date.now();
  const result = await chatCompletion({
    model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: 0,
    max_tokens: maxTokens,
  });
  return {
    content: result.content,
    finishReason: result.finishReason,
    usage: result.usage,
    duration_ms: Date.now() - start,
  };
}

export interface PipelineResult {
  reviewContent: CodeReviewContentV2;
  repoMetadata: RepoMetadata;
  pipelineLog: PipelineLog;
  costUsd: number;
}

export async function runCodeReviewPipeline(params: {
  repoUrl: string;
  commitSha?: string;
  checkpointRefs?: CheckpointRef[];
  challenge: Challenge;
  briefText: string | null;
  onProgress?: (step: string) => void | Promise<void>;
}): Promise<PipelineResult> {
  const config = mergeConfig(params.challenge.codeReviewConfig);
  const stages: Record<string, PipelineStageLog> = {};
  let totalCost = 0;
  const pipelineStart = Date.now();

  const progress = params.onProgress ?? (() => {});

  // Stage 1: Ingest
  await progress("Cloning repository...");
  const ingestStart = Date.now();
  const { files, metadata } = await ingestRepo(params.repoUrl, config.token_budget, params.commitSha);
  stages.ingest = {
    status: "completed",
    duration_ms: Date.now() - ingestStart,
  };

  if (files.length === 0) {
    throw new Error("Repository is empty or could not be read.");
  }

  const commonParams = {
    challenge: params.challenge,
    briefText: params.briefText,
    files,
    metadata,
    language: config.language,
  };

  // Stage 2: Run sub-reviewers A-D in parallel
  await progress(`Ingested ${files.length} files. Running 4 sub-reviewers...`);
  const [techResult, qualityResult, highlightsResult, originalityResult] =
    await Promise.allSettled([
      runSubReviewer(
        config.models.tech_description,
        buildTechDescriptionPrompt(commonParams),
        OUTPUT_TOKENS.tech_description
      ),
      runSubReviewer(
        config.models.code_quality,
        buildCodeQualityPrompt(commonParams),
        OUTPUT_TOKENS.code_quality
      ),
      runSubReviewer(
        config.models.highlights_issues,
        buildHighlightsPrompt(commonParams),
        OUTPUT_TOKENS.highlights_issues
      ),
      runSubReviewer(
        config.models.originality,
        buildOriginalityPrompt(commonParams),
        OUTPUT_TOKENS.originality
      ),
    ]);

  // Log sub-reviewer results
  function logStage(
    name: string,
    model: string,
    result: PromiseSettledResult<SubReviewerResult>
  ): string | null {
    if (result.status === "fulfilled") {
      const r = result.value;
      stages[name] = {
        status: "completed",
        duration_ms: r.duration_ms,
        model,
        tokens_in: r.usage.prompt_tokens,
        tokens_out: r.usage.completion_tokens,
        ...(r.finishReason === "length" ? { truncated: true } : {}),
      };
      totalCost += r.usage.total_cost;
      return r.content;
    } else {
      stages[name] = {
        status: "failed",
        duration_ms: 0,
        model,
        error: result.reason?.message ?? "Unknown error",
      };
      return null;
    }
  }

  const techContent = logStage("tech_description", config.models.tech_description, techResult);
  const qualityContent = logStage("code_quality", config.models.code_quality, qualityResult);
  const highlightsContent = logStage("highlights_issues", config.models.highlights_issues, highlightsResult);
  const originalityContent = logStage("originality", config.models.originality, originalityResult);

  // Stage 2b: Entire session-history reviewer (advisory bonus). Only when the
  // challenge requires Entire. Reads the checkpoint branch from the repo we
  // ingested (the private fork when available, where we copied the branch).
  // Failures here are non-fatal: the rest of the review proceeds without it.
  let sessionHistory: SessionHistoryAnalysis | null = null;
  if (params.challenge.entireRequired) {
    try {
      const parsedRepo = parseGitHubRepo(params.repoUrl);
      const session = parsedRepo
        ? await ingestSessionHistory(parsedRepo.owner, parsedRepo.repo, {
          checkpointRefs: params.checkpointRefs,
          commitSha: params.commitSha,
        })
        : null;
      if (!session || (session.promptSamples.length === 0 && session.checkpointCount === 0)) {
        sessionHistory = {
          analyzed: false,
          reason: "No usable Entire session history was found in the captured repository.",
          completeness: { score: 0, signed: false, aligns_with_diff: false, assessment: "" },
          process_quality: {
            ownership_language: { score: 0, rationale: "" },
            technical_specificity: { score: 0, rationale: "" },
            iteration_verification: { score: 0, rationale: "" },
            edge_case_awareness: { score: 0, rationale: "" },
          },
          bonus_score: 0,
          agents_detected: session?.agentsDetected ?? [],
          highlights: [],
          summary: "No session history available for analysis.",
        };
      } else {
        await progress("Analyzing Entire session history...");
        const shStart = Date.now();
        const shResult = await chatCompletion({
          model: config.models.coordinator,
          messages: (() => {
            const p = buildSessionHistoryPrompt({
              challenge: params.challenge,
              briefText: params.briefText,
              metadata,
              session,
              language: config.language,
            });
            return [
              { role: "system", content: p.system },
              { role: "user", content: p.user },
            ];
          })(),
          temperature: 0,
          max_tokens: OUTPUT_TOKENS.session_history,
        });
        stages.session_history = {
          status: "completed",
          duration_ms: Date.now() - shStart,
          model: config.models.coordinator,
          tokens_in: shResult.usage.prompt_tokens,
          tokens_out: shResult.usage.completion_tokens,
          ...(shResult.finishReason === "length" ? { truncated: true } : {}),
        };
        totalCost += shResult.usage.total_cost;
        try {
          sessionHistory = parseJson(shResult.content) as SessionHistoryAnalysis;
        } catch {
          stages.session_history = { ...stages.session_history, status: "failed", error: "Unparseable output" };
        }
      }
    } catch (e) {
      stages.session_history = {
        status: "failed",
        duration_ms: 0,
        error: e instanceof Error ? e.message : "Session history analysis failed",
      };
    }
  }

  // Stage 3: Coordinator
  const subDone = [techContent, qualityContent, highlightsContent, originalityContent].filter(Boolean).length;
  await progress(`Sub-reviews done (${subDone}/4). Running coordinator...`);
  const coordinatorPrompt = buildCoordinatorPrompt({
    challenge: params.challenge,
    briefText: params.briefText,
    metadata,
    techResult: techContent,
    qualityResult: qualityContent,
    highlightsResult: highlightsContent,
    originalityResult: originalityContent,
    weights: config.weights,
    language: config.language,
  });

  const coordStart = Date.now();
  const askCoordinator = (maxTokens: number, retryNote?: string) =>
    chatCompletion({
      model: config.models.coordinator,
      messages: [
        { role: "system", content: coordinatorPrompt.system },
        { role: "user", content: retryNote ? `${coordinatorPrompt.user}\n\n${retryNote}` : coordinatorPrompt.user },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    });

  // A cut-off or malformed answer must not fail a review whose sub-reviews are
  // already paid for: ask once more with a higher cap and a firmer format note.
  let coordResult = await askCoordinator(OUTPUT_TOKENS.coordinator);
  let tokensIn = coordResult.usage.prompt_tokens;
  let tokensOut = coordResult.usage.completion_tokens;
  totalCost += coordResult.usage.total_cost;
  let coordJson: unknown = null;
  let retried = false;
  try {
    if (coordResult.finishReason === "length") throw new Error("Coordinator answer was cut off");
    coordJson = parseJson(coordResult.content);
  } catch {
    retried = true;
    await progress("Coordinator answer was incomplete. Retrying once...");
    coordResult = await askCoordinator(
      OUTPUT_TOKENS.coordinator_retry,
      "Return exactly one complete, valid JSON object with no prose. Keep each rationale to two sentences.",
    );
    tokensIn += coordResult.usage.prompt_tokens;
    tokensOut += coordResult.usage.completion_tokens;
    totalCost += coordResult.usage.total_cost;
    try {
      if (coordResult.finishReason === "length") throw new Error("Coordinator answer was cut off");
      coordJson = parseJson(coordResult.content);
    } catch {
      throw new Error("Coordinator returned invalid JSON after one retry");
    }
  }

  stages.coordinator = {
    status: "completed",
    duration_ms: Date.now() - coordStart,
    model: config.models.coordinator,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    ...(retried ? { retried: true } : {}),
  };

  // Parse coordinator output
  const coordParsed = coordJson as {
    executive_summary: string;
    scores: Record<string, { score: number; max: number; weight: number; rationale: string }>;
    weighted_total: number;
    highlights: ReviewHighlight[];
    concerns: ReviewConcern[];
    strengths: string[];
    weaknesses: string[];
    notable_patterns: string;
  };

  // Parse sub-reviewer outputs for additional data
  let techParsed: { tech_stack?: string[]; architecture_pattern?: string; project_summary?: string } = {};
  let originalityParsed: { boilerplate_ratio?: number; custom_code_ratio?: number; assessment?: string } = {};
  let highlightsParsed: { would_it_run?: { verdict: string; reasoning: string } } = {};

  try {
    if (techContent) techParsed = parseJson(techContent) as typeof techParsed;
  } catch { /* skip */ }

  try {
    if (originalityContent) originalityParsed = parseJson(originalityContent) as typeof originalityParsed;
  } catch { /* skip */ }

  try {
    if (highlightsContent) highlightsParsed = parseJson(highlightsContent) as typeof highlightsParsed;
  } catch { /* skip */ }

  await progress("Compiling final report...");

  // Compile final V2 review content
  const reviewContent: CodeReviewContentV2 = {
    version: 2,
    executive_summary: coordParsed.executive_summary,
    summary: techParsed.project_summary ?? coordParsed.executive_summary,
    tech_stack_detected: techParsed.tech_stack ?? metadata.frameworks_detected,
    architecture_pattern: techParsed.architecture_pattern ?? "Unknown",
    scores: coordParsed.scores,
    weighted_total: coordParsed.weighted_total,
    highlights: coordParsed.highlights ?? [],
    concerns: coordParsed.concerns ?? [],
    would_it_run: highlightsParsed.would_it_run ?? { verdict: "unknown", reasoning: "Could not assess" },
    originality: {
      boilerplate_ratio: originalityParsed.boilerplate_ratio ?? 0,
      custom_code_ratio: originalityParsed.custom_code_ratio ?? 1,
      assessment: originalityParsed.assessment ?? "Could not assess",
    },
    strengths: coordParsed.strengths ?? [],
    weaknesses: coordParsed.weaknesses ?? [],
    notable_patterns: coordParsed.notable_patterns ?? "",
    ...(sessionHistory ? { session_history: sessionHistory } : {}),
  };

  const pipelineLog: PipelineLog = {
    stages,
    total_duration_ms: Date.now() - pipelineStart,
    total_cost_usd: totalCost,
  };

  return {
    reviewContent,
    repoMetadata: metadata,
    pipelineLog,
    costUsd: totalCost,
  };
}
