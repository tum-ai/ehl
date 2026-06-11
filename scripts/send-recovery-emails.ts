/**
 * One-time script: notify users whose accounts were bulk-imported from a
 * previous match (created without a usable password) so they can claim
 * their account via the standard "forgot password" flow.
 *
 * Affected users are identified as:
 *   - profiles.role = 'participant'
 *   - never signed in (auth.users.last_sign_in_at is null)
 *
 * Anyone who never signed in has no working credentials, regardless of
 * whether they applied through the platform: self-registered users are
 * signed in immediately after email verification, so a null last_sign_in_at
 * only occurs for imported accounts. Review the dry-run list before sending.
 *
 * The email links to /forgot-password instead of embedding a recovery
 * token: recovery links expire after 1 hour (auth config mailer_otp_exp),
 * which is useless for a bulk send. The forgot-password flow generates a
 * fresh link when the user actually wants one.
 *
 * Set DRY_RUN = false only after Dev team approval.
 *
 * Usage:
 *   npx tsx scripts/send-recovery-emails.ts
 *
 * Required env vars (from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SITE_URL   (used to build the forgot-password link)
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

type Admin = ReturnType<typeof createClient>;

/** All auth users, paginated. Small pages so one bad row pins the failure. */
async function listAllAuthUsers(supabase: Admin) {
  const users: { id: string; last_sign_in_at?: string | null }[] = [];
  const perPage = 20;
  for (let page = 1; page <= 500; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`listUsers failed on page ${page}: ${error.message}`);
      console.error("Run scripts/check-auth-integrity.ts to diagnose.");
      process.exit(1);
    }
    users.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < perPage) break;
  }
  return users;
}

async function fetchAffectedUsers(supabase: Admin): Promise<AffectedUser[]> {
  // Participants with no applications row: candidates for "imported user".
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, name")
    .eq("role", "participant");

  if (error) {
    console.error("Failed to query profiles:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) return [];

  // Anyone who has ever signed in already has working credentials.
  const authUsers = await listAllAuthUsers(supabase);
  const hasSignedIn = new Set(
    authUsers.filter((u) => u.last_sign_in_at).map((u) => u.id)
  );

  return data.filter((p: AffectedUser) => !hasSignedIn.has(p.id));
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

  const forgotPasswordUrl = `${SITE_URL}/forgot-password`;
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    const displayName = user.name?.trim() || "(no name)";

    if (DRY_RUN) {
      console.log(`Would send account-claim email to: ${displayName} <${user.email}>`);
      continue;
    }

    // --- live path (only reached when DRY_RUN = false) ---
    const { sendEmail } = await import("../lib/email.js");
    const { renderAccountClaimEmail } = await import("../lib/emails/render.js");

    const name = user.name?.trim() || "there";
    const html = await renderAccountClaimEmail({
      name,
      email: user.email,
      forgotPasswordUrl,
    });

    try {
      await sendEmail({
        to: user.email,
        subject: "Set your EHL password",
        html,
        skipRateLimit: true,
      });
      sent++;
      console.log(`  [OK] Sent to ${user.email}`);
    } catch (err) {
      failed++;
      console.error(`  [ERROR] Email failed for ${user.email}:`, err);
    }
  }

  console.log(`\n[send-recovery-emails] Summary: ${users.length} affected user(s) found.`);
  if (DRY_RUN) {
    console.log("[send-recovery-emails] DRY RUN complete — re-run with DRY_RUN = false to send.");
  } else {
    console.log(`[send-recovery-emails] Sent: ${sent}, failed: ${failed}.`);
  }
}

main().catch((err) => {
  console.error("[send-recovery-emails] Fatal error:", err);
  process.exit(1);
});
