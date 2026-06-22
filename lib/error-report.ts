/**
 * Helpers for the admin error boundary (app/admin/(dashboard)/error.tsx).
 *
 * React error boundaries can receive a value that is NOT an Error instance —
 * e.g. a stale-bundle / chunk-load failure after a redeploy surfaces as an
 * empty throw, which previously rendered as "Name: undefined / Message:
 * undefined / (no stack)". These helpers normalise any thrown value into a
 * reportable shape and flag the stale-bundle case so the boundary can self-heal.
 */

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

export function describeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "(empty)",
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>;
    const message =
      typeof o.message === "string" && o.message ? o.message : "(empty)";
    return {
      name: typeof o.name === "string" && o.name ? o.name : "UnknownError",
      message,
      stack: typeof o.stack === "string" ? o.stack : undefined,
    };
  }
  if (error === undefined || error === null) {
    return {
      name: "UnknownError",
      // An empty throw with no detail is almost always a chunk-load /
      // navigation failure after a redeploy (the app updated under you).
      message:
        "An empty error was thrown (no detail). This is usually a chunk-load " +
        "or navigation failure after the app updated — reloading typically fixes it.",
    };
  }
  return { name: "UnknownError", message: String(error) };
}

const CHUNK_PATTERNS =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

/**
 * True when the thrown value looks like a stale client bundle: either an
 * explicit chunk-load error, or an empty/undefined throw (the signature of a
 * navigation/chunk failure that carries no message, name, stack, or digest).
 */
export function isLikelyStaleBundleError(error: unknown): boolean {
  if (error === undefined || error === null) return true;
  if (error instanceof Error) {
    return CHUNK_PATTERNS.test(`${error.name} ${error.message}`);
  }
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    const hasDigest = typeof o.digest === "string" && o.digest.length > 0;
    // A server-thrown error carries a digest; never treat those as stale bundle.
    if (hasDigest) return false;
    const name = typeof o.name === "string" ? o.name : "";
    const message = typeof o.message === "string" ? o.message : "";
    if (!name && !message) return true; // empty object throw == no detail
    return CHUNK_PATTERNS.test(`${name} ${message}`);
  }
  return CHUNK_PATTERNS.test(String(error));
}
