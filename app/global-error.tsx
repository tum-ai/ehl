"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Shared reporter: redacts secret URL tokens BEFORE Sentry/console/fetch.
    if (typeof window !== "undefined") {
      reportClientError(error, "GlobalError");
    }
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="bg-[#0B0B1A] text-white font-sans antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <h1 className="text-4xl font-bold text-gold">Something went wrong</h1>
          <p className="mt-4 text-lg text-text-secondary max-w-md">
            An unexpected error occurred. Please try again or contact the organizers if the issue persists.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-text-muted font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="mt-8 rounded-lg bg-gold px-6 py-3 text-sm font-bold text-surface-deep transition-colors hover:bg-gold/90"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
