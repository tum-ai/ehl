"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ─── List all admins ─────────────────────────────────────────

export async function getAdminUsers() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();

  // Check caller is admin
  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!callerProfile || callerProfile.role !== "admin") {
    return { error: "Admin access required" };
  }

  // Get all admin profiles
  const { data: admins } = await adminClient
    .from("profiles")
    .select("id, name, email, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true });

  // Get all allowlisted emails
  const { data: allowlist } = await adminClient
    .from("admin_emails")
    .select("id, email, created_at")
    .order("created_at", { ascending: true });

  return {
    admins: admins ?? [],
    allowlist: allowlist ?? [],
  };
}

// ─── Add admin email to allowlist ────────────────────────────

export async function addAdminEmail(email: string) {
  const normalized = email.toLowerCase().trim();

  const domain = process.env.ADMIN_EMAIL_DOMAIN || "example.com";
  if (!normalized.endsWith(`@${domain}`)) {
    return { error: `Only @${domain} emails can be added as admins.` };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();

  // Check caller is admin
  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!callerProfile || callerProfile.role !== "admin") {
    return { error: "Admin access required" };
  }

  // Check if already exists
  const { data: existing } = await adminClient
    .from("admin_emails")
    .select("id")
    .eq("email", normalized)
    .single();

  if (existing) {
    return { error: "This email is already on the admin allowlist." };
  }

  const { error } = await adminClient
    .from("admin_emails")
    .insert({ email: normalized, added_by: user.id });

  if (error) {
    return { error: error.message };
  }

  // Audit log
  await adminClient.from("admin_audit_log").insert({
    action: "add_admin_email",
    entity_type: "admin_emails",
    performed_by: user.id,
    details: { email: normalized },
  });

  return { success: true };
}

// ─── Remove admin email from allowlist ───────────────────────

export async function removeAdminEmail(email: string) {
  const normalized = email.toLowerCase().trim();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const adminClient = createAdminClient();

  // Check caller is admin
  const { data: callerProfile } = await adminClient
    .from("profiles")
    .select("role, email")
    .eq("id", user.id)
    .single();

  if (!callerProfile || callerProfile.role !== "admin") {
    return { error: "Admin access required" };
  }

  // Prevent removing yourself
  if (callerProfile.email === normalized) {
    return { error: "You cannot remove yourself from the admin list." };
  }

  // Count remaining admins (must keep at least one)
  const { count } = await adminClient
    .from("admin_emails")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) <= 1) {
    return { error: "Cannot remove the last admin." };
  }

  // Remove from allowlist
  const { error } = await adminClient
    .from("admin_emails")
    .delete()
    .eq("email", normalized);

  if (error) {
    return { error: error.message };
  }

  // Downgrade the profile if it exists
  const { data: targetProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("email", normalized)
    .single();

  if (targetProfile) {
    await adminClient
      .from("profiles")
      .update({ role: "participant" })
      .eq("id", targetProfile.id);
  }

  // Audit log
  await adminClient.from("admin_audit_log").insert({
    action: "remove_admin_email",
    entity_type: "admin_emails",
    performed_by: user.id,
    details: { email: normalized },
  });

  return { success: true };
}
