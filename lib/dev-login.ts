/**
 * DEV-ONLY hackathon-simulation login config (see docs/SIM.md).
 *
 * Plain module (no "use server") so it can export constants/types/sync helpers.
 * The server action lives in lib/actions/dev-login.ts.
 */

export interface DevPersona {
  email: string;
  label: string;
  role: "admin" | "jury" | "participant";
  next: string;
}

// These personas can only log in once they exist in auth.users. The canonical
// seed that creates those auth.users rows (and then runs supabase/seed.sql, which
// only populates profiles) is scripts/seed-test-via-api.ts. The fixed UUIDs here
// match the profile rows that script seeds.
export const DEV_PERSONAS: DevPersona[] = [
  { email: "admin@example.com", label: "Admin", role: "admin", next: "/admin" },
  { email: "jury1@example.com", label: "Jury 1", role: "jury", next: "/jury" },
  { email: "jury2@example.com", label: "Jury 2", role: "jury", next: "/jury" },
  { email: "alice@example.com", label: "Alice — Alpha Innovators", role: "participant", next: "/dashboard" },
  { email: "bob@example.com", label: "Bob — Alpha Innovators", role: "participant", next: "/dashboard" },
  { email: "david@example.com", label: "David — Beta Hackers", role: "participant", next: "/dashboard" },
];

export function isDevLoginEnabled(): boolean {
  const enabled = process.env.DEV_LOGIN_ENABLED === "true";
  // Hard tripwire: dev login grants admin/jury/participant sessions with NO
  // credentials, so it must never be live on the production deployment. We cannot
  // key off NODE_ENV here — the Docker sim image intentionally runs
  // NODE_ENV=production (see Dockerfile / docs/SIM.md). VERCEL_ENV is "production"
  // only on the real Vercel production deployment and is undefined in the sim, so
  // this fails loudly if the flag is ever set in prod without breaking the sim.
  if (enabled && process.env.VERCEL_ENV === "production") {
    throw new Error(
      "DEV_LOGIN_ENABLED must never be set on the production deployment."
    );
  }
  return enabled;
}
