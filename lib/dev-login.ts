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

// Matches the fixed-UUID profiles in supabase/seed.sql.
export const DEV_PERSONAS: DevPersona[] = [
  { email: "admin@example.com", label: "Admin", role: "admin", next: "/admin" },
  { email: "jury1@example.com", label: "Jury 1", role: "jury", next: "/jury" },
  { email: "jury2@example.com", label: "Jury 2", role: "jury", next: "/jury" },
  { email: "alice@example.com", label: "Alice — Alpha Innovators", role: "participant", next: "/dashboard" },
  { email: "bob@example.com", label: "Bob — Alpha Innovators", role: "participant", next: "/dashboard" },
  { email: "david@example.com", label: "David — Beta Hackers", role: "participant", next: "/dashboard" },
];

export function isDevLoginEnabled(): boolean {
  return process.env.DEV_LOGIN_ENABLED === "true";
}
