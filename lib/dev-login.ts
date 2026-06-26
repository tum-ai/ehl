/**
 * DEV-ONLY hackathon-simulation login config (see docs/SIM.md).
 *
 * Plain module (no "use server") so it can export constants/types/sync helpers.
 * The server action lives in lib/actions/dev-login.ts.
 */

export interface DevPersona {
  email: string;
  label: string;
  role: "admin" | "jury" | "participant" | "chapter_admin";
  next: string;
}

// These personas can only log in once they exist in auth.users. The canonical
// seed that creates those auth.users rows (and then runs supabase/seed.sql, which
// only populates profiles) is scripts/seed-test-via-api.ts. The fixed UUIDs here
// match the profile rows that script seeds.
export const DEV_PERSONAS: DevPersona[] = [
  { email: "admin@example.com", label: "Admin", role: "admin", next: "/admin" },
  // External partner, local admin of Chapter 2 (Zurich) only. next "/admin"
  // intentionally hits the global home so middleware confinement bounces them
  // to their own chapter — exercising the scoping live.
  { email: "test@partner.com", label: "Partner — Local Admin (Zurich)", role: "chapter_admin", next: "/admin" },
  { email: "jury1@example.com", label: "Jury 1", role: "jury", next: "/jury" },
  { email: "jury2@example.com", label: "Jury 2", role: "jury", next: "/jury" },
  { email: "alice@example.com", label: "Alice — Alpha Innovators", role: "participant", next: "/dashboard" },
  { email: "bob@example.com", label: "Bob — Alpha Innovators", role: "participant", next: "/dashboard" },
  { email: "david@example.com", label: "David — Beta Hackers", role: "participant", next: "/dashboard" },
];

// Admin-only mode for public-facing sim deployments (e.g. the Paris staging
// preview, where SSO is off and anyone can reach the URL). When set, dev login
// offers ONLY the admin persona — participants/jury must use the real flows, so
// a random visitor can't mint a non-admin session. Enforced both in the page UI
// and server-side in devLoginAction (UI filtering alone is not a control).
export function isDevLoginAdminOnly(): boolean {
  return process.env.DEV_LOGIN_ADMIN_ONLY === "true";
}

// Personas offered for the current deployment. In admin-only mode this is just
// the admin persona(s); otherwise the full set.
export function getDevPersonas(): DevPersona[] {
  return isDevLoginAdminOnly()
    ? DEV_PERSONAS.filter((p) => p.role === "admin")
    : DEV_PERSONAS;
}

// The production Supabase project ref. Project refs are NOT secrets (this one is
// already in every client bundle via NEXT_PUBLIC_SUPABASE_URL); naming it here
// lets us refuse to run any test-only feature against the production database.
// NOTE: this ref is also hardcoded in the two code-review workflows
// (.github/workflows/process-code-reviews{,-test}.yml DB guards). If the prod
// Supabase project ever changes, update ALL THREE places.
export const PRODUCTION_SUPABASE_REF = "fdoeygfcjllrzogoymsf";

/**
 * True if the app is currently pointed at the PRODUCTION Supabase project.
 * Parses the host exactly (not a substring match) so a lookalike URL cannot slip
 * through. Returns false if the URL is unset/unparseable (fail-open here is fine:
 * the callers below only USE this to BLOCK, so an unknown DB is treated as "not
 * provably prod" — the VERCEL_ENV tripwire still covers the Vercel prod case).
 */
export function isProductionDatabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  try {
    // Normalize before the exact compare: URL already lowercases the host and
    // strips the port, but a trailing dot ("...supabase.co.") is a VALID FQDN
    // that would otherwise dodge the check, so strip it too.
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host === `${PRODUCTION_SUPABASE_REF}.supabase.co`;
  } catch {
    return false;
  }
}

export function isDevLoginEnabled(): boolean {
  const enabled = process.env.DEV_LOGIN_ENABLED === "true";
  // Hard tripwire: dev login grants admin/jury/participant sessions with NO
  // credentials, so it must never be live on production. Two independent checks,
  // EITHER of which fires:
  //  - VERCEL_ENV === "production": the real Vercel production deployment. We
  //    cannot key off NODE_ENV — the Docker sim image intentionally runs
  //    NODE_ENV=production (see Dockerfile / docs/SIM.md), and VERCEL_ENV is
  //    undefined there, so the sim keeps working while Vercel prod fails loudly.
  //  - isProductionDatabase(): the app is pointed at the PRODUCTION Supabase
  //    project. This closes the gap where VERCEL_ENV is not "production" (a
  //    non-Vercel or prod-like deployment) but the prod DB is in use — a test
  //    feature must NEVER touch prod data regardless of where it runs.
  if (enabled && (process.env.VERCEL_ENV === "production" || isProductionDatabase())) {
    throw new Error(
      "DEV_LOGIN_ENABLED must never be set on a production deployment (Vercel production env or production Supabase database detected)."
    );
  }
  return enabled;
}
