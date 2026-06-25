import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createRedis() {
  // Vercel KV sets KV_REST_API_URL + KV_REST_API_TOKEN automatically
  // Redis.fromEnv() reads these (and UPSTASH_REDIS_REST_* as fallback).
  // NOTE: fromEnv() does NOT throw when the vars are absent — it returns a
  // client with empty credentials — so we must check presence ourselves,
  // otherwise the in-memory fallback would never engage when Redis is
  // unconfigured (only when a live request errors).
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

const redis = createRedis();

// ─── Rate Limiters ──────────────────────────────────────
// Limits are generous: 500+ participants share one WiFi at hackathon events.
// Turnstile CAPTCHA is the primary bot defense; IP limits are a safety net.
//
// Each limiter carries BOTH its Redis limiter (null when Redis is absent) and
// its own in-memory fallback config. The fallback is attached to the limiter
// itself — not a side map keyed by object reference — so it still applies when
// Redis is unconfigured/down (otherwise every endpoint would silently collapse
// to one tiny default limit, blocking legitimate users on shared event WiFi).

interface MemoryFallbackConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  limiter: Ratelimit | null;
  fallback: MemoryFallbackConfig;
  /** Bucket namespace. Used by Redis (Ratelimit prefix) AND the in-memory
   *  fallback so two limiters sharing an identifier (e.g. an email used by both
   *  emailLimiter and resetEmailLimiter) never share a fallback bucket. */
  prefix: string;
}

const DEFAULT_FALLBACK: MemoryFallbackConfig = { limit: 10, windowMs: 60_000 };

function makeLimiter(
  prefix: string,
  perWindow: number,
  window: `${number} s`,
  fallback: MemoryFallbackConfig
): RateLimiter {
  return {
    limiter: redis
      ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(perWindow, window), prefix })
      : null,
    fallback,
    prefix,
  };
}

// Auth endpoints: 500 requests per 60 seconds per IP
export const authLimiter = makeLimiter("rl:auth", 500, "60 s", { limit: 500, windowMs: 60_000 });
// Registration: 500 per 60s per IP
export const registerLimiter = makeLimiter("rl:register", 500, "60 s", { limit: 500, windowMs: 60_000 });
// Password reset: 500 per 60s per IP
export const resetLimiter = makeLimiter("rl:reset", 500, "60 s", { limit: 500, windowMs: 60_000 });
// Application submit: 500 per 60s per IP
export const applicationLimiter = makeLimiter("rl:apply", 500, "60 s", { limit: 500, windowMs: 60_000 });
// Walk-in registration, keyed per walk-in token: a single chapter QR creates real
// accounts, so cap how many walk-ins one token can register in a window. Generous
// for a real event (a volunteer-supervised line), tight enough that a leaked token
// can't be scripted into mass account creation. 60 per 60s per token.
export const walkInTokenLimiter = makeLimiter("rl:walkin-token", 60, "60 s", { limit: 60, windowMs: 60_000 });
// File upload: 50 per hour per user (fallback tighter: 10/min)
export const uploadLimiter = makeLimiter("rl:upload", 50, "3600 s", { limit: 10, windowMs: 60_000 });
// General API: 1000 per 60s per IP (fallback 200/min)
export const apiLimiter = makeLimiter("rl:api", 1000, "60 s", { limit: 200, windowMs: 60_000 });
// Certificate PDF generation: 30 per 60s per IP (CPU-intensive)
export const certLimiter = makeLimiter("rl:cert", 30, "60 s", { limit: 30, windowMs: 60_000 });
// Email sending: 10 per hour per address (fallback 5/min)
export const emailLimiter = makeLimiter("rl:email", 10, "3600 s", { limit: 5, windowMs: 60_000 });
// Password-reset emails: per-RECIPIENT throttle to prevent reset-email bombing of
// a victim address. Separate from the general emailLimiter so a user who recently
// received ordinary transactional mail can still reset, while still capping how
// often reset mail goes to any single address. 3/hour, fallback 1/min.
export const resetEmailLimiter = makeLimiter("rl:reset-email", 3, "3600 s", { limit: 1, windowMs: 60_000 });
// Client error reports: 10 per 60s per IP
export const errorReportLimiter = makeLimiter("rl:error", 10, "60 s", { limit: 10, windowMs: 60_000 });

// ─── In-memory fallback when Redis is unavailable ─────────
// Simple sliding window: Map<identifier, timestamp[]>
// Cleaned up on access. Not shared across serverless instances,
// but provides per-limiter protection when Redis is down.

const memoryStore = new Map<string, number[]>();

export function checkMemoryLimit(
  identifier: string,
  maxRequests: number = DEFAULT_FALLBACK.limit,
  windowMs: number = DEFAULT_FALLBACK.windowMs,
): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;

  let timestamps = memoryStore.get(identifier);
  if (timestamps) {
    timestamps = timestamps.filter((t) => t > windowStart);
  } else {
    timestamps = [];
  }

  if (timestamps.length >= maxRequests) {
    memoryStore.set(identifier, timestamps);
    return false; // limited
  }

  timestamps.push(now);
  memoryStore.set(identifier, timestamps);

  // Periodically clean up stale entries (every ~100 checks)
  if (Math.random() < 0.01) {
    for (const [key, ts] of memoryStore) {
      const fresh = ts.filter((t) => t > windowStart);
      if (fresh.length === 0) memoryStore.delete(key);
      else memoryStore.set(key, fresh);
    }
  }

  return true; // allowed
}

// Exported for testing
export function _resetMemoryStore() {
  memoryStore.clear();
}

let fallbackWarned = false;
function warnFallbackOnce() {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn(
    "[rate-limit] Redis unavailable; using in-memory per-limiter fallback. " +
      "Limits are per-instance, not shared across serverless instances."
  );
}

// Helper to check rate limit and return contextual error if exceeded
export async function checkRateLimit(
  rl: RateLimiter | null,
  identifier: string,
  context?: string
): Promise<{ limited: boolean; error?: string }> {
  const config = rl?.fallback ?? DEFAULT_FALLBACK;
  const limiter = rl?.limiter ?? null;
  // Namespace the in-memory bucket by the limiter's prefix so two distinct
  // limiters that share the same identifier (e.g. emailLimiter + resetEmailLimiter
  // both keyed by an email) do not consume each other's fallback budget. The
  // Redis path is already namespaced via the Ratelimit `prefix`.
  const memoryKey = rl ? `${rl.prefix}:${identifier}` : identifier;
  const errorMsg = context
    ? `Too many ${context} requests. Please wait a minute and try again.`
    : "Too many requests. Please try again later.";

  if (!limiter) {
    // No Redis available: use in-memory fallback with per-limiter limits.
    // Warn once per process to avoid flooding logs under sustained traffic.
    warnFallbackOnce();
    if (!checkMemoryLimit(memoryKey, config.limit, config.windowMs)) {
      return { limited: true, error: errorMsg };
    }
    return { limited: false };
  }

  try {
    const { success } = await limiter.limit(identifier);
    if (!success) {
      return { limited: true, error: errorMsg };
    }
    return { limited: false };
  } catch (err) {
    // Redis error: fall back to in-memory limiter with per-limiter limits
    console.error("[rate-limit] Redis error, falling back to in-memory:", err);
    console.warn(`[rate-limit] Fallback active for: ${memoryKey} (limit: ${config.limit}/${config.windowMs}ms)`);
    if (!checkMemoryLimit(memoryKey, config.limit, config.windowMs)) {
      return { limited: true, error: errorMsg };
    }
    return { limited: false };
  }
}
