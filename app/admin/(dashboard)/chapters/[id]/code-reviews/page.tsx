"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateCodeReviewConfig } from "@/lib/actions/admin";
import { ReportCard } from "@/components/code-review/report-card";
import { LimitBanner } from "@/components/admin/limit-banner";
import { shouldKeepPolling } from "@/lib/code-review/status-summary";
import type { CodeReviewContent, CodeReviewConfig, RepoMetadata, CodeReviewStatus } from "@/lib/types";

interface DispatchResult {
  attempted: boolean;
  ok: boolean;
  reason?: string;
  status?: number;
  message?: string;
}

interface ReviewStatusRow {
  submissionId: string;
  status: CodeReviewStatus;
  progress: string | null;
  costUsd: number | null;
  queuedAt?: string | null;
}

interface WorkerHealth {
  state: "idle" | "ok" | "stuck" | "dispatch_failed";
  message: string | null;
}

interface LastDispatch {
  ok: boolean;
  attempted: boolean;
  message: string | null;
  at: string;
}

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
  /** Step-by-step worker log, shown as an expandable console. */
  pipelineLog: unknown[] | null;
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

// Keep in sync with DEFAULT_CONFIG.models in lib/code-review/pipeline.ts. These
// MUST be current OpenRouter model IDs: the dropdown below loads the live model
// list, and a stale default 400s ("not a valid model ID") at review time.
const DEFAULT_MODELS: CodeReviewConfig["models"] = {
  tech_description: "google/gemini-2.5-flash",
  code_quality: "anthropic/claude-sonnet-4.5",
  highlights_issues: "anthropic/claude-sonnet-4.5",
  originality: "google/gemini-2.5-flash",
  coordinator: "anthropic/claude-sonnet-4.5",
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

    // Use the narrow action that writes ONLY the code-review config. This panel
    // must never touch is_scored / entire_required / etc: doing so via the full
    // updateChallenge silently cleared every flag this form omitted.
    const result = await updateCodeReviewConfig(challenge.id, config);
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
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  // Lightweight per-submission status overview (source of truth for status,
  // progress, cost). Polled cheaply via one chapter-wide endpoint.
  const [statusRows, setStatusRows] = useState<Record<string, ReviewStatusRow>>({});
  const [truncated, setTruncated] = useState(false);
  const [listLimit, setListLimit] = useState(0);
  // Persistent worker-health + last dispatch outcome (survive reloads), so a
  // stuck/failed queue is never a silent black box.
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);
  const [lastDispatch, setLastDispatch] = useState<LastDispatch | null>(null);
  const [retrying, setRetrying] = useState(false);

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

      // Load submissions for each challenge. Status/progress/cost come from the
      // lightweight chapter-wide overview (refreshStatus); we deliberately do NOT
      // fetch the full review record per submission here (that was an N+1 that
      // made the page crawl at ~100 submissions). Completed reviews' full content
      // is fetched lazily, only when needed to render the report (effect below).
      const allSubs: Submission[] = [];

      for (const challenge of challengesRes) {
        const subs = await fetch(
          `/api/admin/chapters/${id}/submissions?challengeId=${challenge.id}`
        )
          .then((r) => r.json())
          .catch(() => []);

        allSubs.push(...subs);
      }

      setSubmissions(allSubs);
      setLoading(false);
    });
  }, [params]);

  // Lightweight chapter-wide status fetch (single request, no review_content
  // blobs). Drives the summary, per-row status/progress/cost, and the LimitBanner.
  async function refreshStatus(id: string) {
    try {
      const res = await fetch(`/api/admin/chapters/${id}/code-reviews`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        reviews: ReviewStatusRow[];
        truncated: boolean;
        limit: number;
        workerHealth?: WorkerHealth;
        lastDispatch?: LastDispatch | null;
      };
      const byId: Record<string, ReviewStatusRow> = {};
      for (const r of data.reviews) byId[r.submissionId] = r;
      setStatusRows(byId);
      setTruncated(Boolean(data.truncated));
      setListLimit(data.limit);
      setWorkerHealth(data.workerHealth ?? null);
      setLastDispatch(data.lastDispatch ?? null);
    } catch {
      // keep existing status on transient failure
    }
  }

  // Manually re-trigger the GitHub Actions worker without re-queuing. For when
  // reviews are stuck Queued because the worker was never triggered.
  async function retryDispatch() {
    setRetrying(true);
    try {
      const res = await fetch("/api/admin/code-reviews/dispatch", { method: "POST" });
      const data = await res.json();
      if (data.dispatch) setDispatchResult(data.dispatch as DispatchResult);
    } catch {
      setQueueError("Failed to trigger the worker. Please try again.");
    }
    if (chapterId) await refreshStatus(chapterId);
    setRetrying(false);
  }

  // Initial status load once the chapter id is known.
  useEffect(() => {
    if (chapterId) refreshStatus(chapterId);
  }, [chapterId]);

  // When a completed OR failed review newly appears in the lightweight overview
  // but we don't yet have its full record, fetch it once so the report (completed)
  // or the console/pipeline log (completed + failed) can render. Processing/queued
  // rows don't need the heavy blob.
  useEffect(() => {
    const missing = Object.values(statusRows).filter(
      (r) =>
        (r.status === "completed" || r.status === "failed") &&
        !reviews[r.submissionId]?.pipelineLog &&
        !reviews[r.submissionId]?.reviewContent
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched: Record<string, CodeReview> = {};
      for (const r of missing) {
        try {
          const full = await fetch(`/api/admin/code-reviews/${r.submissionId}`).then((res) => res.json());
          if (full) fetched[r.submissionId] = full;
        } catch {
          /* skip */
        }
      }
      if (!cancelled && Object.keys(fetched).length > 0) {
        setReviews((prev) => ({ ...prev, ...fetched }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll the lightweight status overview while any review is in flight.
  // Stops polling once nothing is queued/processing (shouldKeepPolling).
  const keepPolling = shouldKeepPolling(
    Object.values(statusRows).map((r) => r.status)
  );
  useEffect(() => {
    if (!keepPolling || !chapterId) return;
    const interval = setInterval(() => refreshStatus(chapterId), 5_000);
    return () => clearInterval(interval);
  }, [keepPolling, chapterId]);

  function getTeamName(teamId: string): string {
    return teams.find((t) => t.id === teamId)?.name || "Unknown";
  }

  function hasRepoUrl(sub: Submission): boolean {
    const fields = sub.fields || {};
    return Object.values(fields).some(
      (v) => typeof v === "string" && v.includes("github.com")
    );
  }

  function applyQueued(ids: string[]) {
    setStatusRows((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        next[id] = {
          submissionId: id,
          status: "queued",
          progress: null,
          costUsd: prev[id]?.costUsd ?? null,
        };
      }
      return next;
    });
  }

  async function queueReview(submissionId: string) {
    setGenerating(submissionId);
    setQueueError(null);
    setDispatchResult(null);
    try {
      const res = await fetch("/api/admin/code-reviews/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: [submissionId] }),
      });
      const data = await res.json();

      if (data.success) {
        applyQueued([submissionId]);
        if (data.dispatch) setDispatchResult(data.dispatch as DispatchResult);
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
    setDispatchResult(null);

    const eligibleSubs = submissions.filter((sub) => {
      const st = statusRows[sub.id]?.status;
      return hasRepoUrl(sub) && (!st || st === "pending" || st === "failed");
    });

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
          applyQueued(ids);
          if (data.dispatch) setDispatchResult(data.dispatch as DispatchResult);
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
  // Status counts come from the lightweight overview (statusRows), the single
  // source of truth that the poller keeps fresh.
  const rows = Object.values(statusRows);
  const queued = rows.filter((r) => r.status === "queued").length;
  const processing = rows.filter((r) => r.status === "processing").length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const totalCost = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);


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

      {/* Dispatch result banner: tells the admin whether the GitHub Actions
          worker was actually triggered. Without this, a misconfigured
          token/repo leaves reviews "Queued" forever with no visible reason. */}
      {dispatchResult && (
        dispatchResult.ok ? (
          <div className="mt-6 flex items-center justify-between rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
            <span>Worker triggered. Reviews are being processed by GitHub Actions.</span>
            <button onClick={() => setDispatchResult(null)} className="ml-4 font-medium underline">Dismiss</button>
          </div>
        ) : (
          <div className="mt-6 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>
              Reviews queued, but the worker was NOT triggered:{" "}
              {dispatchResult.message ?? "GitHub dispatch failed."}{" "}
              Check GITHUB_TOKEN / GITHUB_REPO and the process-code-reviews workflow, or run it manually from the GitHub Actions tab.
            </span>
            <button onClick={() => setDispatchResult(null)} className="ml-4 font-medium underline shrink-0">Dismiss</button>
          </div>
        )
      )}

      {/* Persistent worker health: survives reloads (unlike the transient banner
          above), so a stuck/failed queue is never an invisible black box. Shows
          WHAT is wrong and a one-click Retry dispatch. */}
      {workerHealth && (workerHealth.state === "stuck" || workerHealth.state === "dispatch_failed") && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">
                {workerHealth.state === "dispatch_failed"
                  ? "Worker was not triggered"
                  : "Reviews are stuck in the queue"}
              </p>
              <p className="mt-1">{workerHealth.message}</p>
              {lastDispatch && (
                <p className="mt-2 text-xs text-amber-800">
                  Last dispatch:{" "}
                  {lastDispatch.ok ? "succeeded" : "FAILED"} at{" "}
                  {new Date(lastDispatch.at).toLocaleString()}
                  {lastDispatch.message ? ` — ${lastDispatch.message}` : ""}
                </p>
              )}
            </div>
            <button
              onClick={retryDispatch}
              disabled={retrying}
              className="shrink-0 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
            >
              {retrying ? "Triggering..." : "Retry dispatch"}
            </button>
          </div>
        </div>
      )}

      {/* Truncation warning if the submission list exceeded the query limit. */}
      {truncated && (
        <div className="mt-6">
          <LimitBanner count={listLimit} limit={listLimit} label="submissions" />
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
                    const st = statusRows[sub.id];
                    const status = st?.status;
                    const progress = st?.progress ?? null;
                    const cost = st?.costUsd ?? review?.costUsd ?? null;
                    const hasRepo = hasRepoUrl(sub);
                    const isGenerating = generating === sub.id;

                    return (
                      <Card key={sub.id}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{sub.projectName}</p>
                            <p className="text-sm ad-text-muted">
                              {getTeamName(sub.teamId)}
                              {cost != null && cost > 0 && (
                                <span className="ml-2 font-mono ad-text-gold">${cost.toFixed(2)}</span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {status && getStatusBadge(status)}
                            {hasRepo ? (
                              <Button
                                size="sm"
                                variant={status === "completed" ? "ghost" : "primary"}
                                onClick={() => queueReview(sub.id)}
                                disabled={isGenerating || generatingAll || status === "queued" || status === "processing"}
                              >
                                {isGenerating
                                  ? "Queuing..."
                                  : status === "queued"
                                    ? "Queued"
                                    : status === "processing"
                                      ? "Processing..."
                                      : status === "completed"
                                        ? "Regenerate"
                                        : status === "failed"
                                          ? "Retry"
                                          : "Queue Review"}
                              </Button>
                            ) : (
                              <span className="text-xs ad-text-muted">No repo URL</span>
                            )}
                          </div>
                        </div>

                        {/* Live progress (processing, or queued once the worker
                            started writing a step). */}
                        {progress && (status === "processing" || status === "queued") && (
                          <div className="mt-2 flex items-center gap-2 text-sm ad-text-muted">
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            {progress}
                          </div>
                        )}

                        {/* Queued but no worker step yet: say so explicitly with the
                            wait time, instead of a bare "Queued" that looks frozen. */}
                        {status === "queued" && !progress && (
                          <div className="mt-2 flex items-center gap-2 text-sm ad-text-muted">
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Queued, waiting for the worker to pick it up
                            {st?.queuedAt
                              ? ` (since ${new Date(st.queuedAt).toLocaleTimeString()})`
                              : ""}
                            .
                          </div>
                        )}

                        {/* Error message for failed reviews */}
                        {status === "failed" && progress && (
                          <p className="mt-2 text-xs ad-text-error">{progress}</p>
                        )}

                        {/* Expandable console: the full pipeline log of what the
                            worker did, step by step. The data was always captured
                            (code_reviews.pipeline_log); it just was never shown. */}
                        {(status === "completed" || status === "failed") &&
                          Array.isArray(review?.pipelineLog) &&
                          review.pipelineLog.length > 0 && (
                            <details className="mt-3 border-t ad-border pt-3">
                              <summary className="cursor-pointer text-sm font-medium ad-text-link">
                                View console ({review.pipelineLog.length} steps)
                              </summary>
                              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
                                {review.pipelineLog
                                  .map((line) =>
                                    typeof line === "string" ? line : JSON.stringify(line)
                                  )
                                  .join("\n")}
                              </pre>
                            </details>
                          )}

                        {/* Show review if completed */}
                        {status === "completed" && review?.reviewContent && (
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
