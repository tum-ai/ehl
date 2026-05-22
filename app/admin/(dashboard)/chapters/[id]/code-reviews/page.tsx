"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateChallenge } from "@/lib/actions/admin";
import { ReportCard } from "@/components/code-review/report-card";
import type { CodeReviewContent, CodeReviewConfig, RepoMetadata } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────

interface Challenge {
  id: string;
  title: string;
  sponsorName: string | null;
  codeReviewEnabled: boolean;
  codeReviewConfig: CodeReviewConfig | null;
}

interface Submission {
  id: string;
  challengeId: string;
  teamId: string;
  projectName: string;
  fields: Record<string, string>;
}

interface CodeReview {
  id: string;
  submissionId: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed";
  reviewContent: CodeReviewContent | null;
  repoMetadata: RepoMetadata | null;
  costUsd: number | null;
  reviewVersion: number;
  progress: string | null;
}

interface Team {
  id: string;
  name: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
}

// ─── Defaults ───────────────────────────────────────────────

const DEFAULT_MODELS: CodeReviewConfig["models"] = {
  tech_description: "google/gemini-2.0-flash-001",
  code_quality: "anthropic/claude-sonnet-4-20250514",
  highlights_issues: "anthropic/claude-sonnet-4-20250514",
  originality: "google/gemini-2.0-flash-001",
  coordinator: "anthropic/claude-sonnet-4-20250514",
};

const DEFAULT_WEIGHTS: CodeReviewConfig["weights"] = {
  code_quality: 30,
  architecture: 25,
  challenge_alignment: 25,
  innovation: 20,
};

const MODEL_ROLES: { key: keyof CodeReviewConfig["models"]; label: string; description: string }[] = [
  { key: "tech_description", label: "Tech Description", description: "Analyzes tech stack, architecture (cheap model OK)" },
  { key: "code_quality", label: "Code Quality", description: "Evaluates code readability, structure, best practices" },
  { key: "highlights_issues", label: "Highlights & Issues", description: "Finds impressive and concerning aspects" },
  { key: "originality", label: "Originality", description: "Assesses boilerplate vs. custom code ratio (cheap model OK)" },
  { key: "coordinator", label: "Coordinator", description: "Synthesizes all sub-reviews into final report" },
];

const WEIGHT_KEYS: { key: keyof CodeReviewConfig["weights"]; label: string }[] = [
  { key: "code_quality", label: "Code Quality" },
  { key: "architecture", label: "Architecture" },
  { key: "challenge_alignment", label: "Challenge Alignment" },
  { key: "innovation", label: "Innovation" },
];

// ─── Review Config Editor ───────────────────────────────────

function ReviewConfigEditor({
  challenge,
  models,
  modelsLoading,
  onSaved,
}: {
  challenge: Challenge;
  models: OpenRouterModel[];
  modelsLoading: boolean;
  onSaved: () => void;
}) {
  const existingConfig = challenge.codeReviewConfig;

  const [selectedModels, setSelectedModels] = useState<CodeReviewConfig["models"]>(
    existingConfig?.models ?? DEFAULT_MODELS
  );
  const [weights, setWeights] = useState<CodeReviewConfig["weights"]>(
    existingConfig?.weights ?? DEFAULT_WEIGHTS
  );
  const [language, setLanguage] = useState(existingConfig?.language ?? "en");
  const [tokenBudget, setTokenBudget] = useState(existingConfig?.token_budget ?? 50000);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const weightsTotal = Object.values(weights).reduce((a, b) => a + b, 0);

  async function handleSave() {
    if (weightsTotal !== 100) {
      setMessage(`Weights must sum to 100 (currently ${weightsTotal})`);
      return;
    }

    setSaving(true);
    setMessage(null);

    const config: CodeReviewConfig = {
      models: selectedModels,
      weights,
      language,
      token_budget: tokenBudget,
    };

    const formData = new FormData();
    formData.set("challengeId", challenge.id);
    formData.set("chapterId", ""); // not used for update path matching
    formData.set("title", challenge.title);
    formData.set("codeReviewConfig", JSON.stringify(config));
    if (challenge.codeReviewEnabled) formData.set("codeReviewEnabled", "on");

    const result = await updateChallenge(formData);
    if (result?.error) {
      setMessage(result.error);
    } else {
      setMessage("Configuration saved");
      onSaved();
    }
    setSaving(false);
  }

  // Format price per 1M tokens
  function formatPrice(priceStr: string): string {
    const price = parseFloat(priceStr);
    if (isNaN(price) || price === 0) return "free";
    const perMillion = price * 1_000_000;
    if (perMillion < 0.01) return "<$0.01/M";
    return `$${perMillion.toFixed(2)}/M`;
  }

  return (
    <div className="space-y-6">
      {/* Model Assignment */}
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider ad-text-muted">
          Model Assignment
        </h4>
        {modelsLoading ? (
          <p className="mt-2 text-sm ad-text-muted">Loading available models...</p>
        ) : models.length === 0 ? (
          <p className="mt-2 text-sm ad-text-error">
            No models available. Check your OpenRouter API key in Settings.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {MODEL_ROLES.map(({ key, label, description }) => (
              <div key={key}>
                <label className="block text-sm">
                  <span className="font-medium ad-text-secondary">{label}</span>
                  <select
                    value={selectedModels[key]}
                    onChange={(e) =>
                      setSelectedModels((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-3 py-2 text-sm ad-text"
                  >
                    {/* Keep current value even if not in list */}
                    {!models.find((m) => m.id === selectedModels[key]) && (
                      <option value={selectedModels[key]}>{selectedModels[key]}</option>
                    )}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({formatPrice(m.pricing.prompt)} in, {formatPrice(m.pricing.completion)} out)
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-0.5 text-xs ad-text-muted">
                  {description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weights */}
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wider ad-text-muted">
          Score Weights
          <span className={`ml-2 font-mono ${weightsTotal === 100 ? "ad-text-success" : "ad-text-error"}`}>
            ({weightsTotal}%)
          </span>
        </h4>
        <div className="mt-3 grid grid-cols-2 gap-4">
          {WEIGHT_KEYS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <span className="w-40 shrink-0 ad-text-secondary">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={weights[key]}
                onChange={(e) =>
                  setWeights((prev) => ({
                    ...prev,
                    [key]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                  }))
                }
                className="w-20 rounded-lg border ad-border ad-bg-input px-3 py-2 text-center font-mono text-sm ad-text"
              />
              <span className="ad-text-muted">%</span>
            </label>
          ))}
        </div>
      </div>

      {/* Language & Token Budget */}
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="font-medium ad-text-secondary">Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-3 py-2 text-sm ad-text"
          >
            <option value="en">English</option>
            <option value="de">German</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium ad-text-secondary">Token Budget</span>
          <input
            type="number"
            min={10000}
            max={200000}
            step={5000}
            value={tokenBudget}
            onChange={(e) => setTokenBudget(parseInt(e.target.value) || 50000)}
            className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-3 py-2 font-mono text-sm ad-text"
          />
          <p className="mt-1 text-xs ad-text-muted">Max tokens of repo content to include</p>
        </label>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
        {message && (
          <span className={`text-xs ${message.includes("saved") ? "ad-text-success" : "ad-text-error"}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function AdminCodeReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const searchParams = useSearchParams();
  const focusChallengeId = searchParams.get("challenge");

  const [chapterId, setChapterId] = useState("");
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [reviews, setReviews] = useState<Record<string, CodeReview>>({});
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Model list (loaded once)
  const [availableModels, setAvailableModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Which challenge config panels are open (pre-open from query param)
  const [openConfigs, setOpenConfigs] = useState<Set<string>>(
    focusChallengeId ? new Set([focusChallengeId]) : new Set()
  );

  useEffect(() => {
    // Load models
    fetch("/api/admin/openrouter/models")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAvailableModels(data);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));

    params.then(async ({ id }) => {
      setChapterId(id);

      const [challengesRes, teamsRes] = await Promise.all([
        fetch(`/api/admin/chapters/${id}/challenges`).then((r) => r.json()),
        fetch("/api/admin/teams").then((r) => r.json()),
      ]);

      setChallenges(challengesRes);
      setTeams(teamsRes);

      // Load submissions for each challenge
      const allSubs: Submission[] = [];
      const allReviews: Record<string, CodeReview> = {};

      for (const challenge of challengesRes) {
        const subs = await fetch(
          `/api/admin/chapters/${id}/submissions?challengeId=${challenge.id}`
        )
          .then((r) => r.json())
          .catch(() => []);

        allSubs.push(...subs);

        // Load code reviews for each submission
        for (const sub of subs) {
          const review = await fetch(
            `/api/admin/code-reviews/${sub.id}`
          )
            .then((r) => r.json())
            .catch(() => null);

          if (review) {
            allReviews[sub.id] = review;
          }
        }
      }

      setSubmissions(allSubs);
      setReviews(allReviews);
      setLoading(false);
    });
  }, [params]);

  // Auto-poll review statuses when there are queued/processing reviews
  const hasActive = Object.values(reviews).some(
    (r) => r.status === "queued" || r.status === "processing"
  );
  useEffect(() => {
    if (!hasActive || !chapterId) return;

    const interval = setInterval(async () => {
      const updatedReviews: Record<string, CodeReview> = {};
      for (const sub of submissions) {
        try {
          const review = await fetch(`/api/admin/code-reviews/${sub.id}`).then((r) => r.json());
          if (review) updatedReviews[sub.id] = review;
        } catch {
          // keep existing
        }
      }
      if (Object.keys(updatedReviews).length > 0) {
        setReviews(updatedReviews);
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [hasActive, chapterId, submissions]);

  function getTeamName(teamId: string): string {
    return teams.find((t) => t.id === teamId)?.name || "Unknown";
  }

  function hasRepoUrl(sub: Submission): boolean {
    const fields = sub.fields || {};
    return Object.values(fields).some(
      (v) => typeof v === "string" && v.includes("github.com")
    );
  }

  async function queueReview(submissionId: string) {
    setGenerating(submissionId);
    setQueueError(null);
    try {
      const res = await fetch("/api/admin/code-reviews/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: [submissionId] }),
      });
      const data = await res.json();

      if (data.success) {
        setReviews((prev) => ({
          ...prev,
          [submissionId]: {
            ...(prev[submissionId] || { id: submissionId, submissionId, reviewContent: null, repoMetadata: null, costUsd: null, reviewVersion: 2, progress: null }),
            status: "queued",
            progress: null,
          },
        }));
      } else if (data.error) {
        setQueueError(data.error);
      }
    } catch {
      setQueueError("Failed to queue review. Please try again.");
    }
    setGenerating(null);
  }

  async function queueAllReviews() {
    setGeneratingAll(true);
    setQueueError(null);

    const eligibleSubs = submissions.filter(
      (sub) =>
        hasRepoUrl(sub) &&
        (!reviews[sub.id] || reviews[sub.id].status === "failed")
    );

    const ids = eligibleSubs.map((s) => s.id);
    if (ids.length > 0) {
      try {
        const res = await fetch("/api/admin/code-reviews/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionIds: ids, dispatch: true }),
        });
        const data = await res.json();

        if (data.success) {
          setReviews((prev) => {
            const next = { ...prev };
            for (const id of ids) {
              next[id] = {
                ...(prev[id] || { id, submissionId: id, reviewContent: null, repoMetadata: null, costUsd: null, reviewVersion: 2, progress: null }),
                status: "queued",
                progress: null,
              };
            }
            return next;
          });
        } else if (data.error) {
          setQueueError(data.error);
        }
      } catch {
        setQueueError("Failed to queue reviews. Please try again.");
      }
    }

    setGeneratingAll(false);
  }

  function toggleConfig(challengeId: string) {
    setOpenConfigs((prev) => {
      const next = new Set(prev);
      if (next.has(challengeId)) next.delete(challengeId);
      else next.add(challengeId);
      return next;
    });
  }

  async function reloadChallenges() {
    const res = await fetch(`/api/admin/chapters/${chapterId}/challenges`);
    const data = await res.json();
    setChallenges(data);
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case "completed":
        return <Badge variant="completed" light>Completed</Badge>;
      case "queued":
        return <Badge variant="announced" light>Queued</Badge>;
      case "processing":
        return <Badge variant="announced" light>Processing</Badge>;
      case "failed":
        return <Badge variant="upcoming" light>Failed</Badge>;
      default:
        return <Badge variant="default" light>Pending</Badge>;
    }
  }

  if (loading) {
    return (
      <div>
        <p className="ad-text-muted">Loading...</p>
      </div>
    );
  }

  const totalSubs = submissions.length;
  const withRepo = submissions.filter(hasRepoUrl).length;
  const queued = Object.values(reviews).filter(
    (r) => r.status === "queued"
  ).length;
  const processing = Object.values(reviews).filter(
    (r) => r.status === "processing"
  ).length;
  const completed = Object.values(reviews).filter(
    (r) => r.status === "completed"
  ).length;
  const failed = Object.values(reviews).filter(
    (r) => r.status === "failed"
  ).length;
  const totalCost = Object.values(reviews).reduce(
    (sum, r) => sum + (r.costUsd ?? 0),
    0
  );


  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to Chapter
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Code Reviews</h1>
      <p className="mt-1 ad-text-secondary">
        Generate LLM-powered code reviews for team submissions.
      </p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-4 gap-4 sm:grid-cols-7">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Submissions
          </p>
          <p className="mt-1 font-mono text-2xl font-bold">{totalSubs}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            With Repo
          </p>
          <p className="mt-1 font-mono text-2xl font-bold ad-text-link">{withRepo}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Queued
          </p>
          <p className="mt-1 font-mono text-2xl font-bold ad-text-warning">{queued}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Processing
          </p>
          <p className="mt-1 font-mono text-2xl font-bold ad-text-warning">{processing}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Completed
          </p>
          <p className="mt-1 font-mono text-2xl font-bold ad-text-success">{completed}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Failed
          </p>
          <p className="mt-1 font-mono text-2xl font-bold ad-text-error">{failed}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Total Cost
          </p>
          <p className="mt-1 font-mono text-2xl font-bold ad-text-gold">
            ${totalCost.toFixed(2)}
          </p>
        </Card>
      </div>

      {/* Queue error banner */}
      {queueError && (
        <div className="mt-6 flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{queueError}</span>
          <button onClick={() => setQueueError(null)} className="ml-4 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* Queue All */}
      {withRepo > completed + queued + processing && (
        <div className="mt-6">
          <Button
            onClick={queueAllReviews}
            disabled={generatingAll || !!generating}
          >
            {generatingAll
              ? "Queuing..."
              : `Queue All Reviews (${withRepo - completed - queued - processing} remaining)`}
          </Button>
        </div>
      )}

      {/* Per challenge */}
      <div className="mt-8 space-y-8">
        {challenges.map((challenge) => {
          const challengeSubs = submissions.filter(
            (s) => s.challengeId === challenge.id
          );
          const configOpen = openConfigs.has(challenge.id);
          const hasConfig = challenge.codeReviewConfig &&
            Object.keys(challenge.codeReviewConfig).length > 0 &&
            challenge.codeReviewConfig.models !== undefined;

          return (
            <div key={challenge.id}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="ad-heading text-lg">{challenge.title}</h2>
                  {challenge.sponsorName && (
                    <p className="text-sm ad-text-muted">by {challenge.sponsorName}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasConfig && (
                    <Badge variant="completed" light>Configured</Badge>
                  )}
                  {!challenge.codeReviewEnabled && (
                    <Badge variant="upcoming" light>Review OFF</Badge>
                  )}
                  <button
                    onClick={() => toggleConfig(challenge.id)}
                    className="text-xs ad-text-link transition-colors"
                  >
                    {configOpen ? "Hide Config" : "Configure"}
                  </button>
                </div>
              </div>

              {/* Config Panel */}
              {configOpen && (
                <Card className="mt-3">
                  <h3 className="text-base font-bold">Review Configuration</h3>
                  <p className="mt-1 text-sm ad-text-muted">
                    Choose which models to use for each review stage and how to weight scores.
                    Changes apply to new reviews only.
                  </p>
                  <div className="mt-4">
                    <ReviewConfigEditor
                      challenge={challenge}
                      models={availableModels}
                      modelsLoading={modelsLoading}
                      onSaved={reloadChallenges}
                    />
                  </div>
                </Card>
              )}

              {/* Submissions */}
              {challengeSubs.length > 0 && (
                <div className="mt-4 space-y-3">
                  {challengeSubs.map((sub) => {
                    const review = reviews[sub.id];
                    const hasRepo = hasRepoUrl(sub);
                    const isGenerating = generating === sub.id;

                    return (
                      <Card key={sub.id}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{sub.projectName}</p>
                            <p className="text-sm ad-text-muted">
                              {getTeamName(sub.teamId)}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {review && getStatusBadge(review.status)}
                            {hasRepo ? (
                              <Button
                                size="sm"
                                variant={review?.status === "completed" ? "ghost" : "primary"}
                                onClick={() => queueReview(sub.id)}
                                disabled={isGenerating || generatingAll || review?.status === "queued" || review?.status === "processing"}
                              >
                                {isGenerating
                                  ? "Queuing..."
                                  : review?.status === "queued"
                                    ? "Queued"
                                    : review?.status === "processing"
                                      ? "Processing..."
                                      : review?.status === "completed"
                                        ? "Regenerate"
                                        : review?.status === "failed"
                                          ? "Retry"
                                          : "Queue Review"}
                              </Button>
                            ) : (
                              <span className="text-xs ad-text-muted">No repo URL</span>
                            )}
                          </div>
                        </div>

                        {/* Progress indicator */}
                        {review?.progress && (review.status === "processing" || review.status === "queued") && (
                          <div className="mt-2 flex items-center gap-2 text-sm ad-text-muted">
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            {review.progress}
                          </div>
                        )}

                        {/* Error message for failed reviews */}
                        {review?.status === "failed" && review.progress && (
                          <p className="mt-2 text-xs ad-text-error">{review.progress}</p>
                        )}

                        {/* Show review if completed */}
                        {review?.status === "completed" && review.reviewContent && (
                          <details className="mt-3 border-t ad-border pt-3">
                            <summary className="cursor-pointer text-sm font-medium ad-text-link">
                              View Review
                              {"weighted_total" in review.reviewContent && (
                                <span className="ml-2 font-mono ad-text-gold">
                                  {(review.reviewContent as { weighted_total: number }).weighted_total.toFixed(1)}/10
                                </span>
                              )}
                            </summary>
                            <div className="mt-3">
                              <ReportCard
                                content={review.reviewContent}
                                metadata={review.repoMetadata}
                                costUsd={review.costUsd}
                                light
                              />
                            </div>
                          </details>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}

              {challengeSubs.length === 0 && (
                <p className="mt-3 text-xs ad-text-muted">No submissions yet</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
