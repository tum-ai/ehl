/**
 * Helpers for the admin error boundary (app/admin/(dashboard)/error.tsx) and
 * for form submit handlers that need to tell one transport failure from another.
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

const PAYLOAD_TOO_LARGE_PATTERNS =
  /payload too large|request entity too large|content too large|body exceeded|entity too large|\b413\b/i;

/**
 * True when a thrown value looks like "the request body was rejected as too
 * large". Matters because a server action carrying an oversized file is
 * rejected by the PLATFORM before our code runs, so the only place this can be
 * reported to the user is the client catch block.
 *
 * The shape is not guaranteed: depending on where the rejection happens the
 * client may see a status property, a Next.js body-limit message, or a generic
 * fetch failure whose text mentions 413. All three are matched. A generic
 * network drop deliberately is NOT, since telling someone to shrink their file
 * when their WiFi died would send them down the wrong path.
 */
export function isPayloadTooLargeError(error: unknown): boolean {
  if (error === undefined || error === null) return false;
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    // Some clients surface the status numerically rather than in the message.
    if (o.status === 413 || o.statusCode === 413) return true;
    const name = typeof o.name === "string" ? o.name : "";
    const message = typeof o.message === "string" ? o.message : "";
    return PAYLOAD_TOO_LARGE_PATTERNS.test(`${name} ${message}`);
  }
  return PAYLOAD_TOO_LARGE_PATTERNS.test(String(error));
}

/**
 * Normalise any thrown value into the `Error & { digest }` shape
 * reportClientError() expects, optionally folding in context the reporter has
 * no other way to carry (the API route whitelists its fields, so extra keys
 * would be dropped).
 *
 * Context is appended to the MESSAGE rather than passed alongside it, which is
 * what makes it survive into event_log. Keep values small and non-personal:
 * byte counts and form names, never file names or email addresses.
 */
export function toReportableError(
  error: unknown,
  context?: Record<string, string | number>
): Error & { digest?: string } {
  const described = describeError(error);
  const entries = Object.entries(context ?? {});
  const suffix = entries.length
    ? ` [${entries.map(([k, v]) => `${k}=${v}`).join(" ")}]`
    : "";

  const reportable = new Error(described.message + suffix) as Error & {
    digest?: string;
  };
  reportable.name = described.name;
  if (described.stack) reportable.stack = described.stack;

  if (error && typeof error === "object") {
    const digest = (error as Record<string, unknown>).digest;
    if (typeof digest === "string" && digest) reportable.digest = digest;
  }

  return reportable;
}
