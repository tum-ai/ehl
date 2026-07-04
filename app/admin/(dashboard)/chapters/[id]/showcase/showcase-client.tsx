"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
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
// (yyyy-mm-dd, in LOCAL time to match how the expiry is stored), or "" when
// there is no expiry.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const router = useRouter();
  const baseUrl = showcaseUrl.replace(/[^/]+$/, "");
  const [url, setUrl] = useState(showcaseUrl);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [showCvs, setShowCvs] = useState(initialShowCvs);
  const [expiryDate, setExpiryDate] = useState(toDateInput(initialExpiresAt));
  const [copied, setCopied] = useState(false);
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

  // Persist a settings change. `revert` runs when the server rejects the
  // change: these switches control whether applicant PII/CVs are live, so the
  // UI must never keep showing a state the DB refused — an admin who "turned
  // the showcase off" and got a silent failure would believe a live link is
  // dead. On success, router.refresh() re-syncs the server-rendered props.
  function persist(
    next: { isEnabled?: boolean; showCvs?: boolean; expiresAt?: string | null },
    revert: () => void
  ) {
    startTransition(async () => {
      setStatus(null);
      const result = await setShowcaseSettings(chapterId, next);
      if ("error" in result) {
        revert();
        setStatus({ ok: false, text: result.error });
        return;
      }
      setStatus({ ok: true, text: "Saved." });
      router.refresh();
    });
  }

  function handleToggleEnabled() {
    const prev = enabled;
    const next = !enabled;
    setEnabled(next);
    persist({ isEnabled: next }, () => setEnabled(prev));
  }

  function handleToggleCvs() {
    const prev = showCvs;
    const next = !showCvs;
    setShowCvs(next);
    persist({ showCvs: next }, () => setShowCvs(prev));
  }

  function handleExpiryChange(value: string) {
    const prev = expiryDate;
    setExpiryDate(value);
    // End of the chosen day in the ADMIN'S LOCAL time (repo convention: date
    // strings are parsed as local, never bare/UTC), so "expires July 10" means
    // the whole of July 10 where the admin sits. Guard against non-date input
    // (degraded date fields submit free text) instead of throwing.
    let iso: string | null = null;
    if (value) {
      const d = new Date(`${value}T23:59:59`);
      if (Number.isNaN(d.getTime())) {
        setStatus({ ok: false, text: "Invalid date. Use the date picker or yyyy-mm-dd." });
        setExpiryDate(prev);
        return;
      }
      iso = d.toISOString();
    }
    persist({ expiresAt: iso }, () => setExpiryDate(prev));
  }

  function handleRotate() {
    const confirmed = window.confirm(
      "Rotate the showcase link? The current link will stop working immediately and you will need to reshare the new one with partners."
    );
    if (!confirmed) return;

    startTransition(async () => {
      setStatus(null);
      const result = await rotateShowcaseToken(chapterId);
      if ("error" in result) {
        setStatus({ ok: false, text: result.error });
        return;
      }
      setUrl(`${baseUrl}${result.token}`);
      setStatus({ ok: true, text: "Link rotated. Reshare the new link." });
      router.refresh();
    });
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
            disabled={pending}
            className="rounded-lg border border-error/30 px-6 py-3 text-sm font-bold text-error transition-colors hover:bg-error/5 disabled:opacity-40"
          >
            {pending ? "Working..." : "Rotate link"}
          </button>
        </div>

        <div className="mt-6 space-y-5 border-t ad-border pt-6">
          <Toggle
            checked={enabled}
            onChange={handleToggleEnabled}
            disabled={pending}
            label="Enable showcase"
            description="Off by default. While off, the link returns a 404 for everyone."
          />
          <Toggle
            checked={showCvs}
            onChange={handleToggleCvs}
            disabled={pending}
            label="Show CVs"
            description="Allow partners to view and download applicant CVs. Off by default."
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium ad-heading" htmlFor="showcase-expiry">
              Link expiry
            </label>
            <p className="text-xs ad-text-muted">
              Optional. The link stops working at the end of this day (your local
              time). Leave empty for no expiry.
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

// Lightweight inline stat for use INSIDE a Card (the shared StatCard wraps its
// own Card, which would double-border here).
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
