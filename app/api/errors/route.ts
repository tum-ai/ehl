import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { logEvent } from "@/lib/event-log";
import { checkRateLimit, errorReportLimiter } from "@/lib/ratelimit";
import { redactSecretTokens } from "@/lib/utils";

export async function POST(request: Request) {
  // Rate limit by IP
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(errorReportLimiter, ip);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many error reports" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 10_000) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Redact secret path tokens (e.g. /showcase/<token>, /walk-in/<token>) before
  // persisting: a crash on a token-gated page would otherwise write the live
  // bearer token into the append-only event_log (and any Sentry sink).
  const message = typeof body.message === "string" ? redactSecretTokens(body.message.slice(0, 500)) : "Unknown error";
  const stack = typeof body.stack === "string" ? redactSecretTokens(body.stack.slice(0, 2000)) : undefined;
  const digest = typeof body.digest === "string" ? body.digest.slice(0, 100) : undefined;
  const url = typeof body.url === "string" ? redactSecretTokens(body.url.slice(0, 500)) : "unknown";
  const userAgent = typeof body.userAgent === "string" ? body.userAgent.slice(0, 200) : undefined;

  logEvent({
    action: "client.error",
    entityType: "error",
    entityId: digest || crypto.randomUUID(),
    actorType: "system",
    delta: {
      created: {
        message,
        ...(stack && { stack }),
        url,
        ...(userAgent && { userAgent }),
      },
    },
    metadata: { ip, source: "error_boundary" },
  });

  return NextResponse.json({ ok: true });
}
