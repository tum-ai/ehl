"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEV_PERSONAS, isDevLoginEnabled } from "@/lib/dev-login";

/**
 * DEV-ONLY one-click login for the local hackathon simulation.
 *
 * Establishes a real Supabase session for a fixed seed persona, server-side,
 * with NO Google auth, NO login form, and NO email:
 *   1. Mint a single-use magic-link token via the service role.
 *   2. Consume it immediately with the cookie-aware server client (verifyOtp),
 *      which writes the session cookie onto this action's response.
 *   3. Redirect to the persona's destination.
 *
 * This deliberately does NOT bounce the token through the URL / /auth/callback:
 * magic-link tokens are single-use, so any double request (browser prefetch,
 * a retried click) would consume the token and drop the user on the login page.
 * Verifying server-side consumes it exactly once.
 *
 * HARD GATE: only works when DEV_LOGIN_ENABLED === "true". This must NEVER be
 * enabled in production — it grants admin/jury/participant sessions with no
 * credentials. The page (app/dev-login/page.tsx) 404s under the same flag.
 *
 * Personas are limited to the fixed allowlist (DEV_PERSONAS), so an arbitrary
 * email can't be logged in even if the flag is somehow on. generateLink requires
 * each persona to exist in auth.users; the canonical path that creates those
 * auth.users entries (and then runs supabase/seed.sql, which only populates
 * profiles) is scripts/seed-test-via-api.ts. Seed profiles already carry the
 * right role, so the redirect target (e.g. /admin) passes the middleware role
 * check directly.
 */
export async function devLoginAction(formData: FormData) {
  if (!isDevLoginEnabled()) {
    throw new Error("Dev login is disabled.");
  }

  const email = formData.get("email") as string;
  const persona = DEV_PERSONAS.find((p) => p.email === email);
  if (!persona) {
    throw new Error("Unknown dev persona.");
  }

  // 1. Mint a single-use magic-link token (service role).
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: persona.email,
  });

  if (error || !data.properties?.hashed_token) {
    throw new Error(
      `Failed to mint dev login token for ${persona.email}: ${error?.message ?? "no token"}. ` +
        "Has the shared DB been seeded? scripts/seed-test-via-api.ts creates the " +
        "auth.users entries generateLink needs."
    );
  }

  // 2. Consume it server-side; the cookie-aware client sets the session cookie.
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });

  if (verifyError) {
    throw new Error(`Dev login failed for ${persona.email}: ${verifyError.message}`);
  }

  // 3. Land on the persona's home (seed profile already has the right role).
  redirect(persona.next);
}
