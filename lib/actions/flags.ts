"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminAction, getActingUserId } from "@/lib/admin-auth";
import {
  extractLinkedInUsername,
  extractGitHubUsername,
  normalizeName,
} from "@/lib/flag-utils";
import { logEvent } from "@/lib/event-log";

// ─── Helpers ──────────────────────────────────────────────

// Audit-event actor resolution is centralized in lib/admin-auth.ts.
const getAdminUserId = getActingUserId;

// ─── Create Flag ─────────────────────────────────────────

export async function createFlag(formData: FormData) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  const email = formData.get("email") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const linkedIn = formData.get("linkedIn") as string;
  const github = formData.get("github") as string;
  const reason = formData.get("reason") as string;
  const screenshotUrl = (formData.get("screenshotUrl") as string) || null;

  if (!email || !reason) {
    return { error: "Email and reason are required." };
  }

  const adminClient = createAdminClient();
  const userId = await getAdminUserId();
  if (!userId) return { error: "Could not identify admin user." };

  const linkedinUsername = extractLinkedInUsername(linkedIn);
  const githubUsername = extractGitHubUsername(github);
  const name = normalizeName(firstName, lastName);

  const { data: inserted, error } = await adminClient
    .from("participant_flags")
    .insert({
      email: email.toLowerCase().trim(),
      name,
      linkedin_username: linkedinUsername,
      github_username: githubUsername,
      reason: reason.trim(),
      screenshot_url: screenshotUrl,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  logEvent({
    action: "flag.created",
    entityType: "participant_flag",
    entityId: inserted?.id ?? "unknown",
    actorId: userId,
    actorType: "admin",
    delta: { created: { email, reason } },
  });

  revalidatePath("/admin/flags");
  return { success: true };
}

// ─── Resolve Flag ────────────────────────────────────────

export async function resolveFlag(flagId: string, reason: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr };

  if (!flagId || !reason) {
    return { error: "Flag ID and reason are required." };
  }

  const adminClient = createAdminClient();
  const userId = await getAdminUserId();
  if (!userId) return { error: "Could not identify admin user." };

  const { error } = await adminClient
    .from("participant_flags")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolved_reason: reason.trim(),
    })
    .eq("id", flagId)
    .is("resolved_at", null);

  if (error) return { error: error.message };

  logEvent({
    action: "flag.resolved",
    entityType: "participant_flag",
    entityId: flagId,
    actorId: userId,
    actorType: "admin",
    delta: { status: { from: "active", to: "resolved" } },
  });

  revalidatePath("/admin/flags");
  return { success: true };
}

// ─── Get Flags (for admin management page) ───────────────

export async function getFlags(search?: string) {
  const adminErr = await requireAdminAction();
  if (adminErr) return { error: adminErr, flags: [] };

  const adminClient = createAdminClient();

  let query = adminClient
    .from("participant_flags")
    .select("*")
    .order("created_at", { ascending: false });

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    query = query.or(
      `email.ilike.${s},name.ilike.${s},reason.ilike.${s}`
    );
  }

  const { data: flags, error } = await query;
  if (error) return { error: error.message, flags: [] };

  // Enrich with creator/resolver names
  const userIds = new Set<string>();
  for (const f of flags ?? []) {
    if (f.created_by) userIds.add(f.created_by as string);
    if (f.resolved_by) userIds.add(f.resolved_by as string);
  }

  const nameMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: profiles } = await adminClient
      .from("profiles")
      .select("id, name")
      .in("id", [...userIds]);
    for (const p of profiles ?? []) {
      nameMap.set(p.id as string, (p.name as string) ?? "Unknown");
    }
  }

  const enriched = (flags ?? []).map((f) => ({
    id: f.id as string,
    email: f.email as string,
    name: (f.name as string) ?? null,
    linkedinUsername: (f.linkedin_username as string) ?? null,
    githubUsername: (f.github_username as string) ?? null,
    reason: f.reason as string,
    screenshotUrl: (f.screenshot_url as string) ?? null,
    createdBy: f.created_by as string,
    createdByName: nameMap.get(f.created_by as string) ?? "Unknown",
    createdAt: f.created_at as string,
    resolvedAt: (f.resolved_at as string) ?? null,
    resolvedBy: (f.resolved_by as string) ?? null,
    resolvedByName: f.resolved_by
      ? nameMap.get(f.resolved_by as string) ?? "Unknown"
      : null,
    resolvedReason: (f.resolved_reason as string) ?? null,
  }));

  return { flags: enriched };
}
