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
  // Last code-review worker dispatch outcome (JSON). Persists across reloads so
  // the admin always sees whether the worker was actually triggered.
  CODE_REVIEW_LAST_DISPATCH: "code_review_last_dispatch",
} as const;

export interface CodeReviewDispatchRecord {
  ok: boolean;
  attempted: boolean;
  message: string | null;
  at: string; // ISO timestamp
  eventType?: string;
}

/** Persist the latest dispatch outcome so it survives page reloads. */
export async function recordCodeReviewDispatch(
  record: CodeReviewDispatchRecord
): Promise<void> {
  const adminClient = createAdminClient();
  await adminClient.from("app_settings").upsert(
    {
      key: SETTING_KEYS.CODE_REVIEW_LAST_DISPATCH,
      value: JSON.stringify(record),
      updated_at: record.at,
    },
    { onConflict: "key" }
  );
}

/** Read the latest dispatch outcome, or null if none recorded yet. */
export async function getCodeReviewLastDispatch(): Promise<CodeReviewDispatchRecord | null> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("app_settings")
    .select("value")
    .eq("key", SETTING_KEYS.CODE_REVIEW_LAST_DISPATCH)
    .single();
  if (!data?.value) return null;
  try {
    return JSON.parse(data.value as string) as CodeReviewDispatchRecord;
  } catch {
    return null;
  }
}

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
