/**
 * One-time script: send password recovery emails to imported users who have
 * no password set because they were created via import-team-members.ts rather
 * than the normal registration flow.
 *
 * Set DRY_RUN = false only after Dev team approval.
 *
 * Usage:
 *   npx tsx scripts/send-recovery-emails.ts
 *
 * Required env vars (from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SITE_URL   (used to build the reset link)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// ---------------------------------------------------------------------------
// Set DRY_RUN = false only after Dev team approval.
// ---------------------------------------------------------------------------
const DRY_RUN = true;

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ehl.gg";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

interface AffectedUser {
  id: string;
  email: string;
  name: string | null;
}

async function fetchAffectedUsers(supabase: ReturnType<typeof createClient>): Promise<AffectedUser[]> {
  // Profiles with role = 'participant' that have no matching applications row.
  // These are users created by the import scripts, not the normal registration flow.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, name")
    .eq("role", "participant");

  if (error) {
    console.error("Failed to query profiles:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) return [];

  const emails = data.map((p: AffectedUser) => p.email);

  const { data: applications, error: appError } = await supabase
    .from("applications")
    .select("email")
    .in("email", emails);

  if (appError) {
    console.error("Failed to query applications:", appError.message);
    process.exit(1);
  }

  const emailsWithApplication = new Set(
    (applications ?? []).map((a: { email: string }) => a.email)
  );

  return data.filter((p: AffectedUser) => !emailsWithApplication.has(p.email));
}

async function main() {
  console.log(`[send-recovery-emails] DRY_RUN = ${DRY_RUN}`);
  if (DRY_RUN) {
    console.log("[send-recovery-emails] DRY RUN — no emails will be sent, no DB writes will occur\n");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log("[send-recovery-emails] Querying affected users...");
  const users = await fetchAffectedUsers(supabase);

  if (users.length === 0) {
    console.log("[send-recovery-emails] No affected users found. Nothing to do.");
    return;
  }

  for (const user of users) {
    const displayName = user.name?.trim() || "(no name)";

    if (DRY_RUN) {
      console.log(`Would send recovery email to: ${displayName} <${user.email}>`);
      continue;
    }

    // --- live path (only reached when DRY_RUN = false) ---
    const { sendEmail } = await import("../lib/email.js");
    const { renderPasswordResetEmail } = await import("../lib/emails/render.js");

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: user.email,
      options: {
        redirectTo: `${SITE_URL}/reset-password`,
      },
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error(`  [ERROR] generateLink failed for ${user.email}: ${linkError?.message ?? "no token"}`);
      continue;
    }

    const resetUrl = `${SITE_URL}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=recovery&next=/reset-password`;
    const name = user.name?.trim() || "there";

    const html = await renderPasswordResetEmail({ name, resetUrl });

    try {
      await sendEmail({
        to: user.email,
        subject: "Set your EHL password",
        html,
        skipRateLimit: true,
      });
      console.log(`  [OK] Sent to ${user.email}`);
    } catch (err) {
      console.error(`  [ERROR] Email failed for ${user.email}:`, err);
    }
  }

  console.log(`\n[send-recovery-emails] Summary: ${users.length} affected user(s) found.`);
  if (DRY_RUN) {
    console.log("[send-recovery-emails] DRY RUN complete — re-run with DRY_RUN = false to send.");
  }
}

main().catch((err) => {
  console.error("[send-recovery-emails] Fatal error:", err);
  process.exit(1);
});
