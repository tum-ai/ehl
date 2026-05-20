import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  error?: string;
}

export async function GET() {
  const checks: HealthCheck[] = [];

  // Supabase connectivity
  const dbStart = Date.now();
  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("chapters")
      .select("id", { count: "exact", head: true });
    checks.push({
      name: "supabase",
      status: error ? "unhealthy" : "healthy",
      latencyMs: Date.now() - dbStart,
      ...(error ? { error: error.message } : {}),
    });
  } catch (err) {
    checks.push({
      name: "supabase",
      status: "unhealthy",
      latencyMs: Date.now() - dbStart,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // Redis connectivity (optional)
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const redisStart = Date.now();
    try {
      const res = await fetch(
        `${process.env.UPSTASH_REDIS_REST_URL}/ping`,
        {
          headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
        }
      );
      const ok = res.ok;
      checks.push({
        name: "redis",
        status: ok ? "healthy" : "degraded",
        latencyMs: Date.now() - redisStart,
        ...(!ok ? { error: `HTTP ${res.status}` } : {}),
      });
    } catch (err) {
      checks.push({
        name: "redis",
        status: "degraded", // Redis is optional (in-memory fallback exists)
        latencyMs: Date.now() - redisStart,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // Overall status
  const hasUnhealthy = checks.some((c) => c.status === "unhealthy");
  const hasDegraded = checks.some((c) => c.status === "degraded");
  const overallStatus = hasUnhealthy ? "unhealthy" : hasDegraded ? "degraded" : "healthy";

  const response = {
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  };

  return NextResponse.json(response, {
    status: overallStatus === "unhealthy" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
