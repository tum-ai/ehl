"use client";

import { useEffect, useState } from "react";
import { describeError, isLikelyStaleBundleError } from "@/lib/error-report";
import { redactSecretTokens } from "@/lib/utils";

/**
 * Admin-scoped error boundary — DIAGNOSTIC, not friendly.
 *
 * Admins are trusted operators, so when an admin page fails we show the FULL
 * error detail (name, message, stack, digest, URL, browser) right on screen,
 * copyable, instead of a vague card or a silent blank. The point is that whoever
 * is debugging — operator or developer — sees exactly what broke without having
 * to reproduce it or dig through logs.
 *
 * Note on production: for errors thrown in Server Components, React replaces the
 * message with a generic string and only exposes `digest` (look that digest up
 * in server logs). For client-side errors (hydration, dynamic-import/chunk
 * failures, render exceptions), the real name/message/stack ARE available here
 * even in production — which is exactly the class of failure that was showing as
 * a blank admin panel.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [meta, setMeta] = useState<{ url: string; ua: string; when: string }>({
    url: "",
    ua: "",
    when: "",
  });

  // Normalise the thrown value: React error boundaries can receive a non-Error
  // (e.g. a chunk-load / DOM-conflict throw) that has no name/message/stack,
  // which used to render as the unhelpful "undefined / undefined / no stack".
  const info = describeError(error);
  const maybeStaleBundle = !error?.digest && isLikelyStaleBundleError(error);

  useEffect(() => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const when = new Date().toISOString();
    setMeta({ url, ua, when });

    // Redacted console line (a token-bearing URL/stack must not reach ANY log
    // sink raw); the on-screen report keeps the raw values, since the admin
    // viewing their own URL is not a leak.
    console.error("[AdminRouteError]", info.name, redactSecretTokens(info.message));
    // Report to the event log so it's also captured server-side (best-effort).
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: redactSecretTokens(info.message),
        stack: info.stack ? redactSecretTokens(info.stack) : info.stack,
        digest: error?.digest,
        url: redactSecretTokens(url),
        userAgent: ua,
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const report = [
    `Admin error report`,
    `When:    ${meta.when}`,
    `URL:     ${meta.url}`,
    `Name:    ${info.name}`,
    `Message: ${info.message}`,
    error?.digest ? `Digest:  ${error.digest}` : null,
    `Browser: ${meta.ua}`,
    ``,
    `Stack:`,
    info.stack ?? "(no stack available)",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return (
    // admin-light keeps the panel self-contained: the ad-* classes resolve the
    // --admin-* CSS vars that are only defined under .admin-light/.admin-dark, so
    // the diagnostics render styled even if this boundary is ever relocated above
    // the layout's admin-light wrapper.
    <div className="admin-light mx-auto mt-8 max-w-3xl">
      <div className="ad-border ad-bg-error rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="ad-heading text-xl ad-text-error">Admin page error</h1>
            <p className="ad-text-secondary mt-1 text-sm">
              The page failed to render. Full details below (visible because you are an admin).
            </p>
            {maybeStaleBundle && (
              <p className="ad-text-secondary mt-2 text-sm">
                This looks like a stale-bundle or chunk-load failure (often after the
                app updated, or a dynamic import like the camera scanner failed to
                load). A full reload usually fixes it.
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => reset()}
              className="ad-border ad-bg-card ad-text rounded-lg border px-3 py-1.5 text-sm font-medium"
            >
              Retry
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(report).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => {}
                );
              }}
              className="rounded-lg bg-gold px-3 py-1.5 text-sm font-bold text-surface-deep hover:bg-gold/90"
            >
              {copied ? "Copied" : "Copy report"}
            </button>
          </div>
        </div>
      </div>

      {/* Full diagnostic dump */}
      <dl className="ad-border ad-bg-card mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-xl border p-5 text-sm">
        <dt className="ad-text-muted font-medium">Name</dt>
        <dd className="ad-text font-mono break-all">{info.name}</dd>

        <dt className="ad-text-muted font-medium">Message</dt>
        <dd className="ad-text font-mono break-all">{info.message || "(empty)"}</dd>

        {error?.digest && (
          <>
            <dt className="ad-text-muted font-medium">Digest</dt>
            <dd className="ad-text font-mono break-all">
              {error.digest}
              <span className="ad-text-muted"> (look up in server logs for server-thrown errors)</span>
            </dd>
          </>
        )}

        <dt className="ad-text-muted font-medium">URL</dt>
        <dd className="ad-text font-mono break-all">{meta.url}</dd>

        <dt className="ad-text-muted font-medium">When</dt>
        <dd className="ad-text font-mono break-all">{meta.when}</dd>

        <dt className="ad-text-muted font-medium">Browser</dt>
        <dd className="ad-text font-mono break-all">{meta.ua}</dd>
      </dl>

      <div className="ad-border ad-bg-card mt-4 rounded-xl border p-5">
        <p className="ad-text-muted mb-2 text-xs font-bold uppercase tracking-wider">Stack trace</p>
        <pre className="ad-text max-h-[50vh] overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
          {info.stack ?? "(no stack available — in production, server-component errors expose only the digest above)"}
        </pre>
      </div>
    </div>
  );
}
