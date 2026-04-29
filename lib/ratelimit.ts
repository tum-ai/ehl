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

// Auth endpoints: 5 requests per 60 seconds
export const authLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "60 s"), prefix: "rl:auth" })
  : null;

// Registration: 3 requests per 60 seconds
export const registerLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "60 s"), prefix: "rl:register" })
  : null;

// Password reset: 3 requests per 60 seconds
export const resetLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "60 s"), prefix: "rl:reset" })
  : null;

// Application submit: 3 requests per 60 seconds
export const applicationLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "60 s"), prefix: "rl:apply" })
  : null;

// File upload: 10 requests per hour
export const uploadLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "3600 s"), prefix: "rl:upload" })
  : null;

// General API: 1000 requests per 60 seconds per IP
// (generous: 500+ participants share one WiFi at events)
export const apiLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1000, "60 s"), prefix: "rl:api" })
  : null;

// Certificate PDF generation: 10 per 60 seconds per IP (CPU-intensive)
export const certLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "rl:cert" })
  : null;

// Email sending: 3 per hour per address
export const emailLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "3600 s"), prefix: "rl:email" })
  : null;

// ─── Per-limiter in-memory fallback configuration ────────────
// When Redis is unavailable, each limiter uses its own fallback limits
// instead of a single generous default. This prevents auth-sensitive
// endpoints from being more permissive than their Redis configuration.

interface MemoryFallbackConfig {
  limit: number;
  windowMs: number;
}

const DEFAULT_FALLBACK: MemoryFallbackConfig = { limit: 5, windowMs: 60_000 };

const memoryFallbackConfig = new Map<Ratelimit | null, MemoryFallbackConfig>();
if (authLimiter) memoryFallbackConfig.set(authLimiter, { limit: 5, windowMs: 60_000 });
if (registerLimiter) memoryFallbackConfig.set(registerLimiter, { limit: 3, windowMs: 60_000 });
if (resetLimiter) memoryFallbackConfig.set(resetLimiter, { limit: 3, windowMs: 60_000 });
if (applicationLimiter) memoryFallbackConfig.set(applicationLimiter, { limit: 3, windowMs: 60_000 });
if (uploadLimiter) memoryFallbackConfig.set(uploadLimiter, { limit: 2, windowMs: 60_000 });
if (apiLimiter) memoryFallbackConfig.set(apiLimiter, { limit: 100, windowMs: 60_000 });
if (certLimiter) memoryFallbackConfig.set(certLimiter, { limit: 10, windowMs: 60_000 });
if (emailLimiter) memoryFallbackConfig.set(emailLimiter, { limit: 1, windowMs: 60_000 });

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

// Helper to check rate limit and return error if exceeded
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ limited: boolean; error?: string }> {
  const config = memoryFallbackConfig.get(limiter) ?? DEFAULT_FALLBACK;

  if (!limiter) {
    // No Redis available: use in-memory fallback with per-limiter limits
    console.warn(`[rate-limit] Redis unavailable, using in-memory fallback for: ${identifier}`);
    if (!checkMemoryLimit(identifier, config.limit, config.windowMs)) {
      return { limited: true, error: "Too many requests. Please try again later." };
    }
    return { limited: false };
  }

  try {
    const { success } = await limiter.limit(identifier);
    if (!success) {
      return { limited: true, error: "Too many requests. Please try again later." };
    }
    return { limited: false };
  } catch (err) {
    // Redis error: fall back to in-memory limiter with per-limiter limits
    console.error("[rate-limit] Redis error, falling back to in-memory:", err);
    console.warn(`[rate-limit] Fallback active for: ${identifier} (limit: ${config.limit}/${config.windowMs}ms)`);
    if (!checkMemoryLimit(identifier, config.limit, config.windowMs)) {
      return { limited: true, error: "Too many requests. Please try again later." };
    }
    return { limited: false };
  }
}
