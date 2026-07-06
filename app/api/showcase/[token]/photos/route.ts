import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { Zip, ZipPassThrough } from "fflate";
import { downloadFile } from "@/lib/gdrive";
import { getShowcaseByToken } from "@/lib/actions/showcase";
import {
  getShowcasePhotoList,
  filterChapterPhotoFileIds,
} from "@/lib/queries/showcase";
import { checkRateLimit, showcasePhotoZipLimiter } from "@/lib/ratelimit";
import { QUERY_LIMITS } from "@/lib/config/limits";

// Sequential Drive fetches at ~1s each: 150 photos needs far more than the 60s
// default. Vercel Pro allows per-route overrides up to 300s (same as the CV ZIP
// and the cron route).
export const maxDuration = 300;

// Bulk photo download for the partner showcase: one ZIP with the requested
// gallery photos (or all of them, if no selection is sent).
//
// POST, not GET: the client sends a body of the selected Drive fileIds. That
// list is caller-controlled, so it is NEVER trusted — filterChapterPhotoFileIds
// intersects it with the chapter's real photo ids (server-resolved), so a
// smuggled id (e.g. a CV's fileId) is dropped and never fetched. An empty/absent
// selection means "download everything".
//
// Gating chain mirrors the CV ZIP: live token (enabled, unexpired) -> the
// chapter's own gallery photos only. Photos carry no personal-consent gate (they
// are event photos, not documents), but the same tight per-IP ZIP limiter
// applies: one ZIP fans out to two Drive calls per photo, and a leaked link must
// not become a mass-exfil loop.
//
// Memory: one photo buffered at a time, zipped with STORE (level 0 — JPEGs are
// already compressed) through a pull-based ReadableStream, so a slow client
// applies real backpressure and a disconnect stops fetching. Failures mid-stream
// cannot change the committed 200 status, so failed photos are skipped and
// listed in a _MANIFEST.txt — never a silently corrupt or incomplete archive.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit(showcasePhotoZipLimiter, ip, "showcase-photo-zip");
  if (rl.limited) {
    return NextResponse.json(
      { error: rl.error ?? "Too many downloads. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const showcase = await getShowcaseByToken(token);
  if (!showcase) return notFound();

  // Parse the optional selection. A malformed body is treated as "no selection"
  // (download all) rather than an error: the button always produces a download.
  let requestedIds: string[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body?.fileIds)) {
      requestedIds = body.fileIds
        .filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
        .slice(0, QUERY_LIMITS.showcasePhotoZip + 1);
    }
  } catch {
    // no body / not JSON -> download all
  }

  // Resolve which photos to include. A selection is validated against the
  // chapter's real photos (drops smuggled ids); no selection -> all photos.
  const photos =
    requestedIds.length > 0
      ? (await filterChapterPhotoFileIds(showcase.chapterId, requestedIds)).map((fileId) => ({
          fileId,
          caption: null as string | null,
        }))
      : await getShowcasePhotoList(showcase.chapterId);

  if (photos.length === 0) {
    return NextResponse.json({ error: "No photos available" }, { status: 404 });
  }
  if (photos.length > QUERY_LIMITS.showcasePhotoZip) {
    // Refuse loudly BEFORE any bytes stream: a silently truncated archive would
    // read as "all photos" to a sponsor.
    return NextResponse.json(
      {
        error: `${photos.length} photos exceed the bulk-download limit of ${QUERY_LIMITS.showcasePhotoZip}. Select fewer, or download them in batches.`,
      },
      { status: 413 }
    );
  }

  // Unique, filesystem-safe entry names: photo_001.jpg, ... The extension is
  // resolved from each file's Drive mime type as it is fetched.
  const usedNames = new Set<string>();
  const extFor = (mimeType: string): string => {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/avif") return "avif";
    if (mimeType === "image/gif") return "gif";
    return "jpg";
  };
  const entryName = (n: number, ext: string): string => {
    const base = `photo_${String(n).padStart(3, "0")}`;
    let name = `${base}.${ext}`;
    for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}.${ext}`;
    usedNames.add(name);
    return name;
  };

  let index = 0;
  let cancelled = false;
  let includedCount = 0;
  const failed: string[] = [];
  let zip: Zip;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull() {
      // Each pull zips exactly ONE fetched photo (skipping failures until one
      // succeeds or the list is exhausted), so chunks are only produced when the
      // consumer asks for more.
      while (!cancelled && index < photos.length) {
        const photo = photos[index++];
        try {
          const { buffer, mimeType } = await downloadFile(photo.fileId);
          if (cancelled) return;
          const entry = new ZipPassThrough(entryName(index, extFor(mimeType)));
          zip.add(entry);
          entry.push(new Uint8Array(buffer), true);
          includedCount++;
          return;
        } catch (err) {
          console.error(`Showcase photo zip: failed to fetch photo ${photo.fileId}:`, err);
          failed.push(photo.fileId);
        }
      }
      if (cancelled) return;
      // All photos handled: write the manifest (a partially failed run is
      // self-describing) and finish the archive.
      const manifest = [
        `EHL Partner Showcase - photo archive`,
        `Included: ${includedCount}`,
        ...(failed.length > 0
          ? [
              ``,
              `FAILED to fetch (retry later or download individually): ${failed.length}`,
              ...failed.map((id) => `  ! ${id}`),
            ]
          : []),
        ``,
      ].join("\n");
      const manifestEntry = new ZipPassThrough("_MANIFEST.txt");
      zip.add(manifestEntry);
      manifestEntry.push(new TextEncoder().encode(manifest), true);
      zip.end();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="ehl-photos.zip"',
      // Behind a bearer link: never cache, never index, never leak the token via
      // referrer — same hygiene as the CV ZIP.
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });
}
