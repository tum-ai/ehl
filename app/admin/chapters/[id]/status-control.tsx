"use client";

import { useState, useEffect, useCallback } from "react";
import { updateChapterStatus, getChapterReadiness } from "@/lib/actions/admin";
import type { ChapterStatus } from "@/lib/types";

const STATUS_FLOW: { value: ChapterStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "announced", label: "Announced" },
  { value: "applications_open", label: "Applications Open" },
  { value: "screening", label: "Preparation" },
  { value: "registration_open", label: "Challenge Selection" },
  { value: "submissions_open", label: "Submissions Open" },
  { value: "pitching", label: "Pitching" },
  { value: "completed", label: "Completed" },
];

interface StatusCheck {
  label: string;
  passed: boolean;
}

interface StatusControlProps {
  chapterId: string;
  initialStatus: ChapterStatus;
  refreshKey?: number;
}

export function StatusControl({ chapterId, initialStatus, refreshKey }: StatusControlProps) {
  const [status, setStatus] = useState<ChapterStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [checks, setChecks] = useState<StatusCheck[]>([]);
  const [nextStatus, setNextStatus] = useState<string | null>(null);

  const currentIndex = STATUS_FLOW.findIndex((s) => s.value === status);

  const loadChecks = useCallback(async () => {
    const result = await getChapterReadiness(chapterId);
    if ("error" in result) return;
    setChecks(result.checks ?? []);
    setNextStatus(result.nextStatus ?? null);
  }, [chapterId]);

  useEffect(() => {
    loadChecks();
  }, [loadChecks, status, refreshKey]);

  async function handleChange(newStatus: ChapterStatus) {
    if (newStatus === status) return;

    const label = STATUS_FLOW.find((s) => s.value === newStatus)?.label;
    if (!confirm(`Change status to "${label}"?`)) return;

    setSaving(true);
    setMessage(null);

    const result = await updateChapterStatus(chapterId, newStatus);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setStatus(newStatus);
      setMessage({ type: "success", text: `Status changed to "${label}".` });
      setTimeout(() => setMessage(null), 3000);
    }
    setSaving(false);
  }

  const failedChecks = checks.filter((c) => !c.passed);
  const allPassed = checks.length > 0 && failedChecks.length === 0;

  return (
    <div className="mt-6 rounded-2xl ad-border ad-bg-card ui-card-subtle p-6">
      <h2 className="mb-4 ad-heading text-lg">Chapter Status</h2>

      {/* Status flow visualization */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FLOW.map((step, i) => {
          const isCurrent = step.value === status;
          const isPast = i < currentIndex;

          return (
            <button
              key={step.value}
              onClick={() => handleChange(step.value)}
              disabled={saving || isCurrent}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                isCurrent
                  ? "ad-bg-warning ad-text-warning ring-1 ring-amber-300"
                  : isPast
                    ? "ad-bg-success ad-text-success ad-bg-card-hover"
                    : "ad-bg-elevated ad-text-muted ad-bg-card-hover"
              } disabled:cursor-default`}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      {/* Readiness checks for next status */}
      {nextStatus && checks.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] ad-text-muted">
            Readiness: {STATUS_FLOW.find((s) => s.value === nextStatus)?.label}
          </p>
          <div className="space-y-1.5">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 text-sm">
                <span
                  className={
                    check.passed ? "ad-text-success" : "ad-text-error"
                  }
                >
                  {check.passed ? "\u2713" : "\u2717"}
                </span>
                <span
                  className={
                    check.passed
                      ? "ad-text-secondary"
                      : "ad-text-error"
                  }
                >
                  {check.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick advance button */}
      {currentIndex < STATUS_FLOW.length - 1 && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() =>
              handleChange(STATUS_FLOW[currentIndex + 1].value)
            }
            disabled={saving || (!allPassed && checks.length > 0)}
            className="rounded-lg bg-gradient-to-r from-gold to-gold-dark px-4 py-2.5 text-sm font-bold text-surface-deep transition-all hover:shadow-[0_0_20px_rgba(255,204,106,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving
              ? "Updating..."
              : `Advance to: ${STATUS_FLOW[currentIndex + 1].label}`}
          </button>
          <span className="text-xs ad-text-muted">
            Step {currentIndex + 1} of {STATUS_FLOW.length}
          </span>
        </div>
      )}

      {message && (
        <p
          className={`mt-3 rounded-lg px-4 py-2.5 text-sm whitespace-pre-line ${
            message.type === "error"
              ? "ad-bg-error ad-text-error"
              : "ad-bg-success ad-text-success"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
