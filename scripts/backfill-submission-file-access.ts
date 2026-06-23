/**
 * Backfill "anyone with link" read access on already-uploaded submission files.
 *
 * Submission artifacts (pitch decks etc.) uploaded BEFORE the link-access fix
 * (makeFileLinkReadable in the submissions upload route) are still private, so
 * the jury cannot open them. This grants link access to every Drive file
 * referenced in a submission's `fields`. It is SCOPED to the submissions table —
 * it never touches CVs or admin uploads.
 *
 * Idempotent: re-granting "anyone reader" on a file that already has it is a
 * no-op as far as the result is concerned.
 *
 * Run: dotenv -e .env.local -- tsx scripts/backfill-submission-file-access.ts
 *      (use .env.test to target the test instance)
 * Add --dry to only list what WOULD be granted.
 */
import { createClient } from "@supabase/supabase-js";
import { makeFileLinkReadable } from "../lib/gdrive";

const DRY = process.argv.includes("--dry");

/** Extract a Drive fileId from a /file/d/<id>/... URL, else null. */
function driveFileId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: subs, error } = await db.from("submissions").select("id, fields");
  if (error) {
    console.error("Failed to read submissions:", error.message);
    process.exit(1);
  }

  const fileIds = new Set<string>();
  for (const s of subs ?? []) {
    const fields = (s.fields ?? {}) as Record<string, unknown>;
    for (const v of Object.values(fields)) {
      const id = driveFileId(v);
      if (id) fileIds.add(id);
    }
  }

  console.log(
    `Found ${fileIds.size} Drive file(s) across ${subs?.length ?? 0} submission(s).` +
      (DRY ? " (dry run, not granting)" : "")
  );

  let ok = 0;
  let failed = 0;
  for (const id of fileIds) {
    if (DRY) {
      console.log(`  would grant: ${id}`);
      continue;
    }
    try {
      await makeFileLinkReadable(id);
      ok++;
      console.log(`  granted: ${id}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED: ${id} -> ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!DRY) console.log(`Done. granted=${ok} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
