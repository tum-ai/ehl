import type { Challenge, RepoMetadata } from "@/lib/types";
import type { RepoFile } from "./ingest";

// ─── Shared challenge context ────────────────────────────────

function buildChallengeContext(params: {
  challenge: Challenge;
  briefText: string | null;
}): string {
  const { challenge, briefText } = params;
  const parts: string[] = [];

  parts.push(`## Challenge: ${challenge.title}`);

  if (challenge.description) {
    parts.push(`\n### Description\n${challenge.description}`);
  }

  if (challenge.judgingCriteria) {
    parts.push(`\n### Judging Criteria\n${challenge.judgingCriteria}`);
  }

  if (challenge.prizeDescription) {
    parts.push(`\n### Prize\n${challenge.prizeDescription}`);
  }

  if (challenge.sponsorName) {
    parts.push(`\n### Sponsor: ${challenge.sponsorName}`);
  }

  if (briefText) {
    parts.push(`\n### Challenge Brief Document\n${briefText}`);
  }

  if (challenge.codeReviewInstructions) {
    parts.push(`\n### Additional Review Instructions\n${challenge.codeReviewInstructions}`);
  }

  return parts.join("\n");
}

function buildCodeContext(files: RepoFile[], metadata: RepoMetadata): string {
  const parts: string[] = [];

  parts.push("## Repository Metadata");
  parts.push(`- Primary Language: ${metadata.primary_language}`);
  parts.push(`- Total LOC: ${metadata.total_loc}`);
  parts.push(`- Files: ${metadata.file_count}`);
  parts.push(`- Commits: ${metadata.commit_count}`);
  parts.push(`- README: ${metadata.has_readme ? "yes" : "no"}`);
  parts.push(`- Dockerfile: ${metadata.has_dockerfile ? "yes" : "no"}`);
  parts.push(`- Tests: ${metadata.has_tests ? "yes" : "no"}`);
  if (metadata.frameworks_detected.length > 0) {
    parts.push(`- Frameworks: ${metadata.frameworks_detected.join(", ")}`);
  }
  if (metadata.sampled) {
    parts.push("- Note: Repository was too large. Only a representative sample of files is included.");
  }

  parts.push("\n## Repository Contents\n");

  for (const file of files) {
    parts.push(`### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n`);
  }

  return parts.join("\n");
}

// ─── Sub-Reviewer A: Tech Description ────────────────────────

export function buildTechDescriptionPrompt(params: {
  challenge: Challenge;
  briefText: string | null;
  files: RepoFile[];
  metadata: RepoMetadata;
  language: string;
}): { system: string; user: string } {
  const lang = params.language === "de" ? "German" : "English";

  return {
    system: `You are a technical analyst evaluating hackathon project submissions. Analyze the submitted project and describe what it does, its tech stack, and architecture.

Respond in ${lang}.
Respond ONLY with valid JSON matching this exact structure. Do not wrap in markdown code blocks.

{
  "project_summary": "2-3 sentences describing what the project does and its purpose",
  "tech_stack": ["Technology1", "Technology2", ...],
  "tech_stack_reasoning": "Brief explanation of why this stack was likely chosen",
  "architecture_pattern": "One of: Monolith, Client-Server, Microservices, Serverless, Jamstack, Other",
  "key_dependencies": ["notable external APIs or services integrated"]
}`,
    user: `${buildChallengeContext({ challenge: params.challenge, briefText: params.briefText })}

${buildCodeContext(params.files, params.metadata)}`,
  };
}

// ─── Sub-Reviewer B: Code Quality ────────────────────────────

export function buildCodeQualityPrompt(params: {
  challenge: Challenge;
  briefText: string | null;
  files: RepoFile[];
  metadata: RepoMetadata;
  language: string;
}): { system: string; user: string } {
  const lang = params.language === "de" ? "German" : "English";

  return {
    system: `You are a senior software engineer evaluating code quality of a hackathon prototype. This is a 24-48 hour hackathon project, not production code. Evaluate relative to what is realistic under extreme time pressure. Clever solutions under constraints matter more than perfect code.

Respond in ${lang}.
Respond ONLY with valid JSON matching this exact structure. Do not wrap in markdown code blocks.

{
  "readability": { "score": 0, "rationale": "2-3 sentences" },
  "structure": { "score": 0, "rationale": "2-3 sentences" },
  "error_handling": { "score": 0, "rationale": "2-3 sentences" },
  "best_practices": { "score": 0, "rationale": "2-3 sentences" },
  "overall_code_quality": { "score": 0, "rationale": "2-3 sentences" }
}

Scores are 1-10 integers. A 5 means "acceptable for a hackathon". A 7+ means "impressive given the time constraints". A 3 or below means "significant issues even for a prototype".`,
    user: `${buildChallengeContext({ challenge: params.challenge, briefText: params.briefText })}

${buildCodeContext(params.files, params.metadata)}`,
  };
}

// ─── Sub-Reviewer C: Highlights & Issues ─────────────────────

export function buildHighlightsPrompt(params: {
  challenge: Challenge;
  briefText: string | null;
  files: RepoFile[];
  metadata: RepoMetadata;
  language: string;
}): { system: string; user: string } {
  const lang = params.language === "de" ? "German" : "English";

  return {
    system: `You are an experienced hackathon judge reviewing project submissions. Find the most impressive and the most concerning aspects of this project. Reference specific files and approximate line numbers where possible.

Respond in ${lang}.
Respond ONLY with valid JSON matching this exact structure. Do not wrap in markdown code blocks.

{
  "highlights": [
    {
      "description": "What is impressive or clever",
      "file": "path/to/file.ts",
      "line": 42,
      "why_notable": "Why this stands out"
    }
  ],
  "concerns": [
    {
      "description": "What is problematic",
      "file": "path/to/file.ts",
      "severity": "low | medium | high | critical",
      "explanation": "What could go wrong and why"
    }
  ],
  "would_it_run": {
    "verdict": "yes | probably | unlikely | no",
    "reasoning": "Based on setup files, dependencies, obvious crashes"
  }
}

Include 2-5 highlights and 2-5 concerns. If nothing is notably impressive or concerning, include fewer entries rather than forcing weak ones. A "critical" severity means the project would likely crash or have a security vulnerability. A "low" severity is a minor code smell.`,
    user: `${buildChallengeContext({ challenge: params.challenge, briefText: params.briefText })}

${buildCodeContext(params.files, params.metadata)}`,
  };
}

// ─── Sub-Reviewer D: Originality ─────────────────────────────

export function buildOriginalityPrompt(params: {
  challenge: Challenge;
  briefText: string | null;
  files: RepoFile[];
  metadata: RepoMetadata;
  language: string;
}): { system: string; user: string } {
  const lang = params.language === "de" ? "German" : "English";

  return {
    system: `You are analyzing a hackathon project's originality. Determine how much of the code is custom work versus boilerplate, templates, or scaffolding. Focus on the ratio of custom code to template code. Do NOT try to detect whether code was written by AI, as this is unreliable.

Respond in ${lang}.
Respond ONLY with valid JSON matching this exact structure. Do not wrap in markdown code blocks.

{
  "boilerplate_ratio": 0.35,
  "custom_code_ratio": 0.65,
  "boilerplate_indicators": ["indicator 1", "indicator 2"],
  "custom_work_indicators": ["indicator 1", "indicator 2"],
  "git_activity_assessment": "normal | single_large_commit | minimal_history",
  "assessment": "1-2 sentence overall originality assessment"
}

Ratios should sum to 1.0. A standard create-react-app with no modifications is ~0.9 boilerplate. A project built from scratch is ~0.1 boilerplate. Most hackathon projects fall in the 0.3-0.5 boilerplate range.`,
    user: `${buildChallengeContext({ challenge: params.challenge, briefText: params.briefText })}

${buildCodeContext(params.files, params.metadata)}`,
  };
}

// ─── Coordinator ─────────────────────────────────────────────

export function buildCoordinatorPrompt(params: {
  challenge: Challenge;
  briefText: string | null;
  metadata: RepoMetadata;
  techResult: string | null;
  qualityResult: string | null;
  highlightsResult: string | null;
  originalityResult: string | null;
  weights: { code_quality: number; architecture: number; challenge_alignment: number; innovation: number };
  language: string;
}): { system: string; user: string } {
  const lang = params.language === "de" ? "German" : "English";
  const { weights } = params;

  return {
    system: `You are the chief editor of a hackathon jury report. You have received assessments from 4 specialized reviewers. Synthesize their findings into a final, coherent report.

Respond in ${lang}.
Respond ONLY with valid JSON matching this exact structure. Do not wrap in markdown code blocks.

{
  "executive_summary": "3-4 sentences as a human judge would write after 10 minutes of repo review",
  "scores": {
    "code_quality": { "score": 0, "max": 10, "weight": ${weights.code_quality}, "rationale": "1-2 sentences" },
    "architecture": { "score": 0, "max": 10, "weight": ${weights.architecture}, "rationale": "1-2 sentences" },
    "challenge_alignment": { "score": 0, "max": 10, "weight": ${weights.challenge_alignment}, "rationale": "1-2 sentences" },
    "innovation": { "score": 0, "max": 10, "weight": ${weights.innovation}, "rationale": "1-2 sentences" }
  },
  "weighted_total": 0.0,
  "highlights": [
    { "description": "Impressive aspect", "file": "path/to/file", "line": 42 }
  ],
  "concerns": [
    { "description": "Concerning aspect", "severity": "low | medium | high | critical", "file": "path/to/file" }
  ],
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2", "weakness 3"],
  "notable_patterns": "Any interesting design patterns or creative solutions"
}

Calculate weighted_total as: sum(score * weight) / sum(weights), rounded to 1 decimal.
Include 2-4 highlights and 2-4 concerns, selecting the most significant ones from the reviewer outputs.
Include exactly 3 strengths and 3 weaknesses for the summary.

Scoring guidelines:
- code_quality (weight ${weights.code_quality}%): Readability, structure, error handling, best practices
- architecture (weight ${weights.architecture}%): System design, component organization, data flow
- challenge_alignment (weight ${weights.challenge_alignment}%): How well the project addresses the challenge requirements
- innovation (weight ${weights.innovation}%): Creative approaches, novel solutions, originality`,
    user: `${buildChallengeContext({ challenge: params.challenge, briefText: params.briefText })}

## Repository Overview
- Language: ${params.metadata.primary_language}
- LOC: ${params.metadata.total_loc}
- Files: ${params.metadata.file_count}
- Commits: ${params.metadata.commit_count}
- Frameworks: ${params.metadata.frameworks_detected.join(", ") || "none detected"}

## Reviewer A: Technical Description
${params.techResult ?? "[FAILED - reviewer did not return results]"}

## Reviewer B: Code Quality Assessment
${params.qualityResult ?? "[FAILED - reviewer did not return results]"}

## Reviewer C: Highlights & Issues
${params.highlightsResult ?? "[FAILED - reviewer did not return results]"}

## Reviewer D: Originality Assessment
${params.originalityResult ?? "[FAILED - reviewer did not return results]"}`,
  };
}
