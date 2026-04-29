import { createAdminClient } from "@/lib/supabase/admin";

export interface AppSetting {
  key: string;
  value: string;
  expiresAt: string | null;
  updatedAt: string;
}

export const SETTING_KEYS = {
  GITHUB_TOKEN: "github_token",
  GITHUB_ORG: "github_org",
  AI_API_KEY: "ai_api_key",
  AI_PROVIDER: "ai_provider",
  OPENROUTER_API_KEY: "openrouter_api_key",
} as const;

/**
 * Get a single setting value by key. Used by API routes/actions that need tokens.
 * Falls back to env var if no DB setting exists.
 */
export async function getSettingValue(
  key: string,
  envFallback?: string
): Promise<string | null> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (data?.value) return data.value as string;
  return envFallback ?? null;
}
