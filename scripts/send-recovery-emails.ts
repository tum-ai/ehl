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

  if (DRY_RUN) {
    for (const user of users) {
      const displayName = user.name?.trim() || "(no name)";
      console.log(`Would send account-claim email to: ${displayName} <${user.email}>`);
    }
    console.log(`\n[send-recovery-emails] Summary: ${users.length} affected user(s) found.`);
    console.log("[send-recovery-emails] DRY RUN complete — re-run with DRY_RUN = false to send.");
    return;
  }

  // --- live send, batched with pauses to avoid SMTP throttling/spam flags ---
  const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 50);
  const PAUSE_MS = Number(process.env.PAUSE_SECONDS ?? 60) * 1000;

  // Resume support: a sent-log lets a re-run skip addresses already emailed if
  // the process is interrupted. One email per line.
  const { sendEmail } = await import("../lib/email.js");
  const { renderAccountClaimEmail } = await import("../lib/emails/render.js");
  const { appendFileSync, readFileSync, existsSync } = await import("fs");
  const SENT_LOG = "recovery-emails-sent.log";

  const alreadySent = new Set<string>(
    existsSync(SENT_LOG)
      ? readFileSync(SENT_LOG, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)
      : []
  );
  const pending = users.filter((u) => !alreadySent.has(u.email));
  if (alreadySent.size > 0) {
    console.log(`[send-recovery-emails] Resuming: ${alreadySent.size} already sent, ${pending.length} remaining.`);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let sent = 0;
  let failed = 0;
  const failures: string[] = [];
  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);

  console.log(
    `[send-recovery-emails] Sending ${pending.length} emails in ${totalBatches} batch(es) of ` +
      `${BATCH_SIZE}, ${PAUSE_MS / 1000}s between batches.\n`
  );

  for (let b = 0; b < totalBatches; b++) {
    const batch = pending.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    console.log(`--- Batch ${b + 1}/${totalBatches} (${batch.length} emails) ---`);

    for (const user of batch) {
      const name = user.name?.trim() || "there";
      const html = await renderAccountClaimEmail({ name, email: user.email, forgotPasswordUrl });
      try {
        await sendEmail({ to: user.email, subject: "Set your EHL password", html, skipRateLimit: true });
        sent++;
        appendFileSync(SENT_LOG, user.email + "\n");
      } catch (err) {
        failed++;
        failures.push(user.email);
        console.error(`  [ERROR] ${user.email}: ${(err as Error).message}`);
      }
    }

    const done = sent + failed;
    console.log(`  batch done. total sent=${sent}, failed=${failed}, progress ${done}/${pending.length}`);

    // Pause between batches (not after the last one)
    if (b < totalBatches - 1) {
      console.log(`  pausing ${PAUSE_MS / 1000}s...\n`);
      await sleep(PAUSE_MS);
    }
  }

  console.log(`\n[send-recovery-emails] Done. Sent: ${sent}, failed: ${failed} (of ${pending.length} pending).`);
  if (failures.length > 0) {
    console.log(`[send-recovery-emails] Failed addresses (re-run to retry — sent ones are skipped):`);
    failures.forEach((e) => console.log(`  ${e}`));
  }
  console.log(`[send-recovery-emails] Sent-log: ${SENT_LOG} (delete it to allow a full re-send).`);
}

main().catch((err) => {
  console.error("[send-recovery-emails] Fatal error:", err);
  process.exit(1);
});
