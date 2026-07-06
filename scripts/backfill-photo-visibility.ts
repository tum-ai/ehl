/**
 * One-off backfill: make every existing gallery photo's Drive file
 * link-readable.
 *
 * Photos are displayed via lh3.googleusercontent.com thumbnails, which only
 * work for "anyone with the link" files. uploadFile() creates PRIVATE files,
 * and until addChapterPhoto() started granting read access (2026-07-06), every
 * uploaded photo landed private - the gallery rendered broken images. This
 * script loops all media rows of type "photo" and grants link-read on each
 * (ensureFileLinkReadable is idempotent and refuses files the service account
 * does not own, so re-running is safe).
 *
 * Usage (env must provide Supabase service key + GOOGLE_DRIVE_CREDENTIALS):
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/backfill-photo-visibility.ts
 */
import { createClient } from "@supabase/supabase-js";
import { ensureFileLinkReadable, getFileMimeType } from "../lib/gdrive";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data: rows, error } = await supabase
    .from("media")
    .select("id, url, chapter_id")
    .eq("type", "photo")
    .limit(2000);
  if (error) {
    console.error("Failed to list photos:", error.message);
    process.exit(1);
  }

  console.log(`Backfilling link-readability for ${rows?.length ?? 0} photos...`);
  let ok = 0;
  const failed: string[] = [];
  // Same provenance guard as addChapterPhoto: never publicize a file that is
  // not an image or that is referenced as an application's CV (a smuggled CV
  // id in a media row must not become public via a re-run of this script).
  const { data: cvRows, error: cvError } = await supabase
    .from("applications")
    .select("cv_url")
    .not("cv_url", "is", null)
    .limit(10000);
  if (cvError) {
    console.error("Failed to list CV file ids:", cvError.message);
    process.exit(1);
  }
  const cvFileIds = new Set((cvRows ?? []).map((r) => r.cv_url as string));

  for (const row of rows ?? []) {
    if (cvFileIds.has(row.url as string)) {
      failed.push(`${row.id} (file ${row.url}): REFUSED - referenced as a CV`);
      continue;
    }
    const mimeType = await getFileMimeType(row.url as string);
    if (!mimeType || !mimeType.startsWith("image/")) {
      failed.push(`${row.id} (file ${row.url}): REFUSED - not an image (${mimeType ?? "unreadable"})`);
      continue;
    }
    const readable = await ensureFileLinkReadable(row.url as string);
    if (readable) {
      ok++;
      if (ok % 25 === 0) console.log(`  ${ok}/${rows!.length} done`);
    } else {
      failed.push(`${row.id} (file ${row.url})`);
    }
  }

  console.log(`Done. Readable: ${ok}/${rows?.length ?? 0}.`);
  if (failed.length > 0) {
    console.log(`FAILED (fix manually or re-run):`);
    for (const f of failed) console.log(`  ! ${f}`);
    process.exit(1);
  }
}

main();
