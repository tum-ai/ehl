"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireChapterAdminAction } from "@/lib/admin-auth";
import { getSession } from "@/lib/actions/auth";
import { logEvent } from "@/lib/event-log";
import { checkRateLimit, showcaseLimiter } from "@/lib/ratelimit";
import type { ResolvedShowcase, ShowcaseSettings } from "@/lib/showcase-shared";

// One place for the settings-row projection so the four queries below cannot
// drift apart.
const SHOWCASE_COLUMNS = "showcase_token, is_enabled, show_cvs, expires_at, rotated_at";

// ─── Resolve a chapter from a showcase token ─────────────────
//
// The showcase token lives in the admin-only chapter_partner_showcase table,
// which has NO anon read policy (RLS gates rows not columns, so the token could
// not live on the publicly-readable chapters row). We therefore read it with the
// service-role client. We look a chapter up BY token and never expose the token
// list. A miss returns null UNIFORMLY (no oracle distinguishing "no such token"
// from "disabled" from "expired" from "token maps to a missing chapter").
//
// Every consumer inherits two protections enforced HERE, not per call site:
// - per-IP rate limiting, so the resolver can't be used as an unthrottled
//   token-validity oracle / DB-load amplifier;
// - a real DB error THROWS (into the error boundary) instead of collapsing to
//   null — a Supabase outage must not make every shared partner link look
//   permanently revoked.
export async function getShowcaseByToken(
  token: string
): Promise<ResolvedShowcase | null> {
  if (!token) return null;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit(showcaseLimiter, ip, "showcase");
  if (rl.limited) return null;

  const adminClient = createAdminClient();

  const { data: row, error } = await adminClient
    .from("chapter_partner_showcase")
    .select("chapter_id, is_enabled, show_cvs, expires_at")
    .eq("showcase_token", token)
    .maybeSingle();

  if (error) throw error;

  if (!row?.chapter_id) return null;
  if (!row.is_enabled) return null;
  if (row.expires_at && new Date(row.expires_at as string).getTime() <= Date.now()) {
    return null;
  }

  return {
    chapterId: row.chapter_id as string,
    showCvs: Boolean(row.show_cvs),
  };
}

// ─── Admin: get-or-create a chapter's showcase settings ──────
//
// Used by the admin showcase page to display the current link + toggles. Lazily
// creates the row (with a fresh uuid via the column default, disabled by
// default) on first view. Guarded to the chapter's admins.
//
// A single upsert (not select-then-insert): two concurrent first visits — e.g.
// Link prefetch racing the navigation render — must both succeed instead of the
// loser 500ing on the chapter_id primary-key conflict. On conflict the upsert
// no-op-updates chapter_id and returns the existing row, defaults intact.
export async function getOrCreateShowcase(
  chapterId: string
): Promise<{ error: string } | ShowcaseSettings> {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const adminClient = createAdminClient();

  const { data: row, error } = await adminClient
    .from("chapter_partner_showcase")
    .upsert({ chapter_id: chapterId }, { onConflict: "chapter_id" })
    .select(SHOWCASE_COLUMNS)
    .single();

  if (error || !row) {
    return { error: error?.message || "Failed to create showcase." };
  }

  return toSettings(chapterId, row);
}

// ─── Admin: rotate a chapter's showcase token ────────────────
//
// Invalidates any previously shared link. Guarded to the chapter's admins.
export async function rotateShowcaseToken(
  chapterId: string
): Promise<{ error: string } | { token: string }> {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const session = await getSession();
  const actorId = session?.profile?.id ?? null;

  const adminClient = createAdminClient();

  const newToken = crypto.randomUUID();
  const { data, error } = await adminClient
    .from("chapter_partner_showcase")
    .upsert(
      {
        chapter_id: chapterId,
        showcase_token: newToken,
        rotated_at: new Date().toISOString(),
        rotated_by: actorId,
      },
      { onConflict: "chapter_id" }
    )
    .select("showcase_token")
    .single();

  if (error || !data) {
    return { error: error?.message || "Failed to rotate token." };
  }

  logEvent({
    action: "chapter.showcase_token_rotated",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { rotated: { chapter_id: chapterId } },
  });

  return { token: data.showcase_token as string };
}

// ─── Admin: update showcase settings (toggles + expiry) ──────
export async function setShowcaseSettings(
  chapterId: string,
  settings: { isEnabled?: boolean; showCvs?: boolean; expiresAt?: string | null }
): Promise<{ error: string } | ShowcaseSettings> {
  const authErr = await requireChapterAdminAction(chapterId);
  if (authErr) return { error: authErr };

  const session = await getSession();
  const actorId = session?.profile?.id ?? null;

  const adminClient = createAdminClient();

  // Only update the fields the caller explicitly passed. Upsert so a chapter
  // whose row does not exist yet is created with the column defaults for any
  // field not supplied (mirrors getOrCreateShowcase's lazy create).
  const patch: Record<string, unknown> = { chapter_id: chapterId };
  if (settings.isEnabled !== undefined) patch.is_enabled = settings.isEnabled;
  if (settings.showCvs !== undefined) patch.show_cvs = settings.showCvs;
  if (settings.expiresAt !== undefined) patch.expires_at = settings.expiresAt;

  const { data, error } = await adminClient
    .from("chapter_partner_showcase")
    .upsert(patch, { onConflict: "chapter_id" })
    .select(SHOWCASE_COLUMNS)
    .single();

  if (error || !data) {
    return { error: error?.message || "Failed to update showcase settings." };
  }

  logEvent({
    action: "chapter.showcase_settings_updated",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { settings },
  });

  return toSettings(chapterId, data);
}

function toSettings(
  chapterId: string,
  row: Record<string, unknown>
): ShowcaseSettings {
  return {
    chapterId,
    token: row.showcase_token as string,
    isEnabled: Boolean(row.is_enabled),
    showCvs: Boolean(row.show_cvs),
    expiresAt: (row.expires_at as string) ?? null,
    rotatedAt: (row.rotated_at as string) ?? null,
  };
}
