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
import {
  buildTechDescriptionPrompt,
  buildCodeQualityPrompt,
  buildHighlightsPrompt,
  buildOriginalityPrompt,
  buildCoordinatorPrompt,
} from "./prompts";

const DEFAULT_CONFIG: CodeReviewConfig = {
  models: {
    tech_description: "google/gemini-2.0-flash-001",
    code_quality: "anthropic/claude-sonnet-4-20250514",
    highlights_issues: "anthropic/claude-sonnet-4-20250514",
    originality: "google/gemini-2.0-flash-001",
    coordinator: "anthropic/claude-sonnet-4-20250514",
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

function parseJson(text: string): unknown {
  // Strip markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(cleaned);
}

interface SubReviewerResult {
  content: string;
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
  const { files, metadata } = await ingestRepo(params.repoUrl, config.token_budget);
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
        2000
      ),
      runSubReviewer(
        config.models.code_quality,
        buildCodeQualityPrompt(commonParams),
        3000
      ),
      runSubReviewer(
        config.models.highlights_issues,
        buildHighlightsPrompt(commonParams),
        3000
      ),
      runSubReviewer(
        config.models.originality,
        buildOriginalityPrompt(commonParams),
        1500
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
  const coordResult = await chatCompletion({
    model: config.models.coordinator,
    messages: [
      { role: "system", content: coordinatorPrompt.system },
      { role: "user", content: coordinatorPrompt.user },
    ],
    temperature: 0,
    max_tokens: 3000,
  });

  stages.coordinator = {
    status: "completed",
    duration_ms: Date.now() - coordStart,
    model: config.models.coordinator,
    tokens_in: coordResult.usage.prompt_tokens,
    tokens_out: coordResult.usage.completion_tokens,
  };
  totalCost += coordResult.usage.total_cost;

  // Parse coordinator output
  const coordParsed = parseJson(coordResult.content) as {
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
