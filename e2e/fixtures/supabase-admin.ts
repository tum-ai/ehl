/**
 * Standalone Supabase admin client for E2E tests.
 * Loads credentials from .env.test (separate test Supabase instance).
 * NEVER connects to production - all test data is isolated.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.test first, fall back to .env.local for backwards compatibility
const testEnvPath = resolve(__dirname, "../../.env.test");
const localEnvPath = resolve(__dirname, "../../.env.local");
config({ path: testEnvPath });
// Only load .env.local if .env.test didn't set the required vars
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  config({ path: localEnvPath });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
    "Create .env.test with your test Supabase credentials (see docs/SETUP.md)."
  );
}

let _client: SupabaseClient | null = null;

/**
 * Singleton admin client for E2E tests. Bypasses RLS via service role key.
 * Connects to the TEST Supabase instance, not production.
 */
export function getAdminClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.BASE_URL || "http://localhost:3000";
}
