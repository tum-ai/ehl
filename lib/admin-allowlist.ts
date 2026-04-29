import { createAdminClient } from "@/lib/supabase/admin";

const ADMIN_EMAIL_DOMAIN = process.env.ADMIN_EMAIL_DOMAIN || "tum-ai.com";

export function getAdminEmailDomain(): string {
  return ADMIN_EMAIL_DOMAIN;
}

export async function isAdminEmail(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();

  if (!normalized.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) return false;

  try {
    const adminClient = createAdminClient();
    const { data } = await adminClient
      .from("admin_emails")
      .select("id")
      .eq("email", normalized)
      .single();

    return !!data;
  } catch {
    // DB unreachable: fall back to env-configured list (no hardcoded emails)
    const fallback = process.env.ADMIN_FALLBACK_EMAILS;
    if (!fallback) return false;
    const fallbackList = fallback.split(",").map((e) => e.trim().toLowerCase());
    return fallbackList.includes(normalized);
  }
}
