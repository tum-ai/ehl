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

// ─── In-memory fallback when Redis is unavailable ─────────
// Simple sliding window: Map<identifier, timestamp[]>
// Cleaned up on access. Not shared across serverless instances,
// but provides basic protection when Redis is down.

const memoryStore = new Map<string, number[]>();
const MEMORY_WINDOW_MS = 60_000; // 1 minute
const MEMORY_MAX_REQUESTS = 5; // match strictest Redis limiter (auth/register/reset)

function checkMemoryLimit(identifier: string): boolean {
  const now = Date.now();
  const windowStart = now - MEMORY_WINDOW_MS;

  let timestamps = memoryStore.get(identifier);
  if (timestamps) {
    timestamps = timestamps.filter((t) => t > windowStart);
  } else {
    timestamps = [];
  }

  if (timestamps.length >= MEMORY_MAX_REQUESTS) {
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

// Helper to check rate limit and return error if exceeded
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ limited: boolean; error?: string }> {
  if (!limiter) {
    // No Redis available: use in-memory fallback
    if (!checkMemoryLimit(identifier)) {
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
    // Redis error: fall back to in-memory limiter
    console.error("Rate limit check failed, using in-memory fallback:", err);
    if (!checkMemoryLimit(identifier)) {
      return { limited: true, error: "Too many requests. Please try again later." };
    }
    return { limited: false };
  }
}
