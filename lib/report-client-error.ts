import { redactSecretTokens } from "@/lib/utils";

/**
 * Single client-side error reporter used by every error boundary.
 *
 * Secrets are redacted HERE, before the error reaches ANY sink (Sentry,
 * console, /api/errors) — the server route's own redaction is a second layer,
 * not the only one. This matters because several routes carry live bearer
 * tokens in the URL (/showcase, /walk-in, /invite): an error boundary that
 * hands the raw error to window.Sentry or console.error would leak them to
 * sinks the server never sees.
 *
 * If a real Sentry SDK is ever wired up, it MUST also ship a beforeSend hook
 * applying redactSecretTokens to event.request.url — the SDK captures
 * window.location.href on its own, outside this function's reach.
 *
 * Call only from client components (uses window/navigator).
 */
export function reportClientError(
  error: Error & { digest?: string },
  label: string
): void {
  const message = redactSecretTokens(error.message ?? "");
  const stack = error.stack ? redactSecretTokens(error.stack) : undefined;

  const sanitized = new Error(message);
  sanitized.name = error.name;
  sanitized.stack = stack;

  const sentry = (window as unknown as {
    Sentry?: { captureException: (e: Error) => void };
  }).Sentry;
  if (sentry) {
    sentry.captureException(sanitized);
  }
  console.error(`[${label}]`, sanitized);

  // Report to event log (best-effort, silent on failure)
  fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      stack,
      digest: error.digest,
      url: redactSecretTokens(window.location.href),
      userAgent: navigator.userAgent,
    }),
  }).catch(() => {});
}
