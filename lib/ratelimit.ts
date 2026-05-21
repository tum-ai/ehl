import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createRedis() {
  // Vercel KV sets KV_REST_API_URL + KV_REST_API_TOKEN automatically
  // Redis.fromEnv() reads these (and UPSTASH_REDIS_REST_* as fallback)
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

// Auth endpoints: 60 requests per 60 seconds per IP
export const authLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s"), prefix: "rl:auth" })
  : null;

// Registration: 60 requests per 60 seconds per IP
export const registerLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s"), prefix: "rl:register" })
  : null;

// Password reset: 60 requests per 60 seconds per IP
export const resetLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s"), prefix: "rl:reset" })
  : null;

// Application submit: 60 requests per 60 seconds per IP
export const applicationLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s"), prefix: "rl:apply" })
  : null;

// File upload: 50 requests per hour per user
export const uploadLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(50, "3600 s"), prefix: "rl:upload" })
  : null;

// General API: 1000 requests per 60 seconds per IP
export const apiLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1000, "60 s"), prefix: "rl:api" })
  : null;

// Certificate PDF generation: 30 per 60 seconds per IP (CPU-intensive)
export const certLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "60 s"), prefix: "rl:cert" })
  : null;

// Email sending: 10 per hour per address
export const emailLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "3600 s"), prefix: "rl:email" })
  : null;

// Client error reports: 10 per 60 seconds per IP
export const errorReportLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "rl:error" })
  : null;

// ─── Per-limiter in-memory fallback configuration ────────────
// When Redis is unavailable, each limiter uses its own fallback limits
// instead of a single generous default. This prevents auth-sensitive
// endpoints from being more permissive than their Redis configuration.

interface MemoryFallbackConfig {
  limit: number;
  windowMs: number;
}

const DEFAULT_FALLBACK: MemoryFallbackConfig = { limit: 10, windowMs: 60_000 };

const memoryFallbackConfig = new Map<Ratelimit | null, MemoryFallbackConfig>();
if (authLimiter) memoryFallbackConfig.set(authLimiter, { limit: 60, windowMs: 60_000 });
if (registerLimiter) memoryFallbackConfig.set(registerLimiter, { limit: 60, windowMs: 60_000 });
if (resetLimiter) memoryFallbackConfig.set(resetLimiter, { limit: 60, windowMs: 60_000 });
if (applicationLimiter) memoryFallbackConfig.set(applicationLimiter, { limit: 60, windowMs: 60_000 });
if (uploadLimiter) memoryFallbackConfig.set(uploadLimiter, { limit: 10, windowMs: 60_000 });
if (apiLimiter) memoryFallbackConfig.set(apiLimiter, { limit: 200, windowMs: 60_000 });
if (certLimiter) memoryFallbackConfig.set(certLimiter, { limit: 30, windowMs: 60_000 });
if (emailLimiter) memoryFallbackConfig.set(emailLimiter, { limit: 5, windowMs: 60_000 });
if (errorReportLimiter) memoryFallbackConfig.set(errorReportLimiter, { limit: 10, windowMs: 60_000 });

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

// Helper to check rate limit and return contextual error if exceeded
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string,
  context?: string
): Promise<{ limited: boolean; error?: string }> {
  const config = memoryFallbackConfig.get(limiter) ?? DEFAULT_FALLBACK;
  const errorMsg = context
    ? `Too many ${context} requests. Please wait a minute and try again.`
    : "Too many requests. Please try again later.";

  if (!limiter) {
    // No Redis available: use in-memory fallback with per-limiter limits
    console.warn(`[rate-limit] Redis unavailable, using in-memory fallback for: ${identifier}`);
    if (!checkMemoryLimit(identifier, config.limit, config.windowMs)) {
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
    console.warn(`[rate-limit] Fallback active for: ${identifier} (limit: ${config.limit}/${config.windowMs}ms)`);
    if (!checkMemoryLimit(identifier, config.limit, config.windowMs)) {
      return { limited: true, error: errorMsg };
    }
    return { limited: false };
  }
}
