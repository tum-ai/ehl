"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAction } from "@/lib/admin-auth";
import type { AppSetting } from "@/lib/settings";
import { logEvent } from "@/lib/event-log";

function maskSettingValue(value: string): string {
  if (value.length <= 12) return "****";
  return value.slice(0, 8) + "..." + value.slice(-4);
}

export async function getSettings(): Promise<AppSetting[]> {
  const adminErr = await requireAdminAction();
  if (adminErr) return [];

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("app_settings")
    .select("*")
    .order("key");

  return (data ?? []).map((row) => ({
    key: row.key as string,
    value: maskSettingValue(row.value as string),
    expiresAt: (row.expires_at as string) ?? null,
    updatedAt: row.updated_at as string,
  }));
}

/**
 * Fetch the full (unmasked) value of a single setting.
 * Used only when an admin is actively editing a setting.
 */
export async function getSettingFullValue(key: string): Promise<string | null> {
  const adminErr = await requireAdminAction();
  if (adminErr) return null;

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  return (data?.value as string) ?? null;
}

export async function upsertSetting(
  key: string,
  value: string,
  expiresAt: string | null
): Promise<{ error?: string; success?: boolean }> {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("app_settings").upsert(
    {
      key,
      value,
      expires_at: expiresAt || null,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "key" }
  );

  if (error) return { error: error.message };

  logEvent({
    action: "setting.updated",
    entityType: "app_setting",
    entityId: key,
    actorType: "admin",
    delta: { updated: { key } },
  });

  return { success: true };
}

/**
 * Check which env var fallbacks are available (returns only existence, never values).
 */
export async function getEnvFallbackStatus(): Promise<Record<string, boolean>> {
  const adminErr = await requireAdminAction();
  if (adminErr) return {};

  // Only check known fallback keys - never expose arbitrary env vars
  const KNOWN_FALLBACKS: Record<string, string> = {
    GITHUB_TOKEN: "GITHUB_TOKEN",
    GITHUB_ORG: "GITHUB_ORG",
    OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
    ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  };

  const result: Record<string, boolean> = {};
  for (const [key, envKey] of Object.entries(KNOWN_FALLBACKS)) {
    result[key] = !!process.env[envKey];
  }
  return result;
}

export async function deleteSetting(
  key: string
): Promise<{ error?: string; success?: boolean }> {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("app_settings")
    .delete()
    .eq("key", key);

  if (error) return { error: error.message };
  return { success: true };
}

