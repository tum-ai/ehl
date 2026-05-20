"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { Sentry?: { captureException: (e: Error) => void } }).Sentry) {
      (window as unknown as { Sentry: { captureException: (e: Error) => void } }).Sentry.captureException(error);
    }
    console.error("[RouteError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold text-gold">Something went wrong</h1>
      <p className="mt-4 text-text-secondary max-w-md">
        An error occurred while loading this page. Please try again.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-text-muted font-mono">
          Error ID: {error.digest}
        </p>
      )}
      <div className="mt-8 flex gap-4">
        <button
          onClick={reset}
          className="rounded-lg bg-gold px-6 py-3 text-sm font-bold text-surface-deep transition-colors hover:bg-gold/90"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-white/10 px-6 py-3 text-sm font-medium text-text-primary transition-colors hover:bg-white/5"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
