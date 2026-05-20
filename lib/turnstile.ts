"use server";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string | null): Promise<boolean> {
  // Skip in development
  if (process.env.NODE_ENV === "development") return true;

  // Emergency bypass: set TURNSTILE_OPTIONAL=true in Vercel env vars
  // when Turnstile is blocking legitimate users (see docs/PRE-EVENT.md)
  if (process.env.TURNSTILE_OPTIONAL === "true") {
    if (!token) console.warn("[Turnstile] No token provided, but TURNSTILE_OPTIONAL=true — allowing");
    return true;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY not set");
    return false;
  }

  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });

    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification failed:", err);
    return false;
  }
}
