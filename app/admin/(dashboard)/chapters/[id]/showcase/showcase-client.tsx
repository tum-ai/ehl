"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { rotateShowcaseToken, setShowcaseSettings } from "@/lib/actions/showcase";
import type { ShowcaseCounts } from "@/lib/queries/showcase";

interface Props {
  chapterId: string;
  chapterName: string;
  showcaseUrl: string;
  isEnabled: boolean;
  showCvs: boolean;
  expiresAt: string | null;
  counts: ShowcaseCounts;
}

// Turn a stored ISO timestamp into the value an <input type="date"> expects
// (yyyy-mm-dd), or "" when there is no expiry.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ShowcaseAdminClient({
  chapterId,
  chapterName,
  showcaseUrl,
  isEnabled: initialEnabled,
  showCvs: initialShowCvs,
  expiresAt: initialExpiresAt,
  counts,
}: Props) {
  const baseUrl = showcaseUrl.replace(/[^/]+$/, "");
  const [url, setUrl] = useState(showcaseUrl);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [showCvs, setShowCvs] = useState(initialShowCvs);
  const [expiryDate, setExpiryDate] = useState(toDateInput(initialExpiresAt));
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus({ ok: false, text: "Could not copy. Select the link and copy manually." });
    }
  }

  function persist(next: { isEnabled?: boolean; showCvs?: boolean; expiresAt?: string | null }) {
    startTransition(async () => {
      setStatus(null);
      const result = await setShowcaseSettings(chapterId, next);
      if ("error" in result) {
        setStatus({ ok: false, text: result.error });
        return;
      }
      setStatus({ ok: true, text: "Saved." });
    });
  }

  function handleToggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    persist({ isEnabled: next });
  }

  function handleToggleCvs() {
    const next = !showCvs;
    setShowCvs(next);
    persist({ showCvs: next });
  }

  function handleExpiryChange(value: string) {
    setExpiryDate(value);
    // Store as end-of-day UTC so the whole chosen day stays valid; empty clears it.
    const iso = value ? new Date(`${value}T23:59:59Z`).toISOString() : null;
    persist({ expiresAt: iso });
  }

  async function handleRotate() {
    const confirmed = window.confirm(
      "Rotate the showcase link? The current link will stop working immediately and you will need to reshare the new one with partners."
    );
    if (!confirmed) return;

    setRotating(true);
    setStatus(null);
    const result = await rotateShowcaseToken(chapterId);
    if ("error" in result) {
      setStatus({ ok: false, text: result.error });
      setRotating(false);
      return;
    }
    setUrl(`${baseUrl}${result.token}`);
    setStatus({ ok: true, text: "Link rotated. Reshare the new link." });
    setRotating(false);
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to chapter
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Partner Showcase</h1>
      <p className="mt-1 ad-text-secondary">{chapterName}</p>

      {/* What a sponsor will see */}
      <Card className="mt-6">
        <h2 className="ad-heading mb-2 text-lg">What partners will see</h2>
        <p className="ad-text-secondary text-sm">
          Only applicants who agreed to share their profile with recruiters and
          sponsors appear on the showcase. Applicants who did not opt in are never
          shown.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric value={counts.visible} label="Visible" tone="ok" />
          <Metric value={counts.hiddenNoConsent} label="Hidden (no consent)" tone="muted" />
          <Metric value={counts.participants} label="Participants" tone="muted" />
          <Metric value={counts.cvsAvailable} label="CVs available" tone="muted" />
        </div>
        <p className="mt-4 text-xs ad-text-muted">
          {counts.total} total applications for this chapter.
        </p>
      </Card>

      {/* Access + settings */}
      <Card className="mt-6">
        <h2 className="ad-heading mb-2 text-lg">Shareable link</h2>
        <p className="ad-text-secondary text-sm">
          Anyone with this link can view the showcase. Treat it as a secret and
          share it only with the intended partner. Rotate it to revoke access.
        </p>

        <p className="mt-4 break-all rounded-lg border ad-border ad-bg-input px-4 py-3 font-mono text-xs ad-text-secondary">
          {url}
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg border ad-border px-6 py-3 text-sm font-bold transition-colors ad-bg-card-hover"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={handleRotate}
            disabled={rotating}
            className="rounded-lg border border-error/30 px-6 py-3 text-sm font-bold text-error transition-colors hover:bg-error/5 disabled:opacity-40"
          >
            {rotating ? "Rotating..." : "Rotate link"}
          </button>
        </div>

        <div className="mt-6 space-y-4 border-t ad-border pt-6">
          <ToggleRow
            label="Enable showcase"
            hint="Off by default. While off, the link returns a 404 for everyone."
            checked={enabled}
            disabled={pending}
            onChange={handleToggleEnabled}
          />
          <ToggleRow
            label="Show CVs"
            hint="Allow partners to view and download applicant CVs. Off by default."
            checked={showCvs}
            disabled={pending}
            onChange={handleToggleCvs}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium ad-heading" htmlFor="showcase-expiry">
              Link expiry
            </label>
            <p className="text-xs ad-text-muted">
              Optional. After this date the link stops working. Leave empty for no expiry.
            </p>
            <input
              id="showcase-expiry"
              type="date"
              value={expiryDate}
              disabled={pending}
              onChange={(e) => handleExpiryChange(e.target.value)}
              className="mt-1 w-fit rounded-lg border ad-border ad-bg-input px-3 py-2 text-sm ad-text-secondary disabled:opacity-40"
            />
          </div>
        </div>

        {status && (
          <p
            className={`mt-4 rounded-lg px-4 py-2 text-sm ${
              status.ok ? "ad-bg-success ad-text-success" : "ad-bg-error ad-text-error"
            }`}
          >
            {status.text}
          </p>
        )}
      </Card>
    </div>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "ok" | "muted";
}) {
  return (
    <div className="rounded-lg border ad-border ad-bg-card px-4 py-3">
      <p className={`font-mono text-2xl font-black ${tone === "ok" ? "text-success" : "ad-heading"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs ad-text-muted">{label}</p>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium ad-heading">{label}</p>
        <p className="text-xs ad-text-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? "bg-success" : "ad-bg-input border ad-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
