"use client";

import { useEffect } from "react";

/**
 * Admin-scoped error boundary.
 *
 * Without this, an error in an admin page's content (e.g. a client chart chunk
 * failing to load) rendered a SILENT BLANK content area inside the admin layout
 * — the sidebar stayed but the main panel was empty, with no way to recover.
 *
 * A very common trigger is a stale client after a deploy: the browser holds old
 * HTML that references chunk hashes which no longer exist, so a dynamic import
 * 404s and throws a ChunkLoadError. We detect that and offer a hard reload that
 * fetches the current build. Uses the admin light theme (ad-* classes).
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|import\(\) failed/i.test(
      `${error.name} ${error.message}`
    );

  useEffect(() => {
    console.error("[AdminRouteError]", error);
    // Best-effort report (silent on failure).
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: typeof window !== "undefined" ? window.location.href : "",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        context: "admin",
      }),
    }).catch(() => {});

    // Stale-deploy self-heal: reload once (cache-busting) so the client fetches
    // the current build. The sessionStorage guard prevents a reload loop.
    if (isChunkError && typeof window !== "undefined") {
      const KEY = "admin_chunk_reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error, isChunkError]);

  return (
    <div className="ad-bg-card ad-border mx-auto mt-12 max-w-lg rounded-xl border p-6 text-center">
      <h1 className="ad-heading text-xl">This page didn’t load fully</h1>
      <p className="ad-text-secondary mt-3">
        {isChunkError
          ? "The app was updated. Reload to get the latest version."
          : "Something went wrong loading this view. Please try again."}
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <button
          onClick={() => reset()}
          className="ad-border ad-bg-card ad-text rounded-lg border px-4 py-2 text-sm font-medium hover:ad-bg-card-hover"
        >
          Try again
        </button>
        <button
          onClick={() => {
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("admin_chunk_reloaded");
              window.location.reload();
            }
          }}
          className="ad-bg-gold rounded-lg px-4 py-2 text-sm font-medium text-black hover:opacity-90"
        >
          Reload page
        </button>
      </div>
      {error.digest && (
        <p className="ad-text-muted mt-4 font-mono text-xs">Ref: {error.digest}</p>
      )}
    </div>
  );
}
