// One-off: resend "Application received" confirmations that were dropped by
// the fire-and-forget email bug (fixed in lib/email-deferred.ts). Reads the
// affected application IDs from the APPLICATION_IDS env var (comma-separated)
// and sends the exact branded template each applicant should have received.
//
// Usage:
//   APPLICATION_IDS=<id1>,<id2> pnpm tsx scripts/resend-application-confirmations.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const ids = (process.env.APPLICATION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    console.error("Set APPLICATION_IDS=<uuid>,<uuid>,...");
    process.exit(1);
  }

  const { sendEmail } = await import("../lib/email.js");
  const { renderApplicationReceivedEmail } = await import("../lib/emails/render.js");
  const { formatDateRange } = await import("../lib/utils.js");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: apps, error } = await supabase
    .from("applications")
    .select("id, email, first_name, chapters(name, city, country, date, date_end)")
    .in("id", ids);
  if (error || !apps) {
    console.error("Failed to load applications:", error?.message);
    process.exit(1);
  }

  for (const app of apps) {
    const chapter = Array.isArray(app.chapters) ? app.chapters[0] : app.chapters;
    if (!chapter) {
      console.error(`Application ${app.id}: no chapter found, skipping`);
      continue;
    }
    const html = await renderApplicationReceivedEmail({
      firstName: app.first_name,
      chapterName: chapter.name,
      chapterCity: `${chapter.city}, ${chapter.country}`,
      chapterDate: formatDateRange(chapter.date, chapter.date_end),
    });
    await sendEmail({
      to: app.email,
      subject: `Application received: ${chapter.name}`,
      html,
      skipRateLimit: true,
    });
    console.log(`Sent confirmation to ${app.email} (${app.id})`);
  }
}

// Note: sends are sequential and logged per ID. If the script dies mid-run,
// re-run ONLY with the IDs that did not log "Sent confirmation" — re-running
// with the full list double-sends to already-confirmed applicants.
main().catch((err) => {
  console.error("[resend-application-confirmations] Failed:", err);
  process.exit(1);
});
