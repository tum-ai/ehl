import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { Zip, ZipPassThrough } from "fflate";
import { downloadFile } from "@/lib/gdrive";
import { getShowcaseByToken } from "@/lib/actions/showcase";
import { getShowcaseCvList } from "@/lib/queries/showcase";
import { checkRateLimit, showcaseCvZipLimiter } from "@/lib/ratelimit";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { slugify } from "@/lib/utils";

// Sequential Drive fetches at ~2s each (metadata + media call per CV): even one
// batch of 100 CVs needs far more than the 60s default. Vercel Pro allows
// per-route overrides up to 300s (same as the cron route).
export const maxDuration = 300;

// Bulk CV download for the partner showcase: a ZIP of the consented, visible
// CVs of the chapter.
//
// BATCHING: a full-size chapter can have hundreds of CVs, and one full-res CV
// takes ~2s to fetch from Drive, so a single ZIP of everything would exceed the
// 300s function timeout (a real 159-CV chapter did: it 413'd and a partner saw
// no working download). Each request serves ONE server-capped window (?offset=,
// optional ?limit=) and reports the consented total + this window's size in
// X-CV-Total / X-CV-Window headers; the client pages by those headers, saving
// one sequential ZIP per window (ehl-cvs.zip, then ehl-cvs-2.zip, -3.zip, ...).
// Each request stays well under the timeout.
//
// Gating chain is IDENTICAL to the single-CV proxy: live token (enabled,
// unexpired) -> show_cvs on -> getShowcaseCvList(), which applies the same
// consent .or() filter + in-code re-check as the list, so the archive can never
// contain a CV the page hides. The batch window is applied AFTER that gate, so
// no offset/limit can ever reach a non-consented CV. On top, a dedicated per-IP
// limiter sized for the batched download starves a leaked-link mass-exfil loop.
//
// Memory: one CV buffered at a time (<=10MB), zipped with STORE (level 0 —
// PDFs are already compressed) through a ReadableStream. Failures mid-stream
// cannot change the committed 200 status, so failed CVs are skipped and listed
// in a _MANIFEST.txt as the final entry — never a silently corrupt or silently
// incomplete archive.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit(showcaseCvZipLimiter, ip, "showcase-cv-zip");
  if (rl.limited) {
    return NextResponse.json(
      { error: rl.error ?? "Too many downloads. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const showcase = await getShowcaseByToken(token);
  if (!showcase) return notFound();
  if (!showcase.showCvs) return notFound();

  const allCvs = await getShowcaseCvList(showcase.chapterId);
  if (allCvs.length === 0) {
    return NextResponse.json({ error: "No CVs available" }, { status: 404 });
  }

  // Optional batch window (?offset=&limit=), applied AFTER the consent gate. A
  // missing/invalid value means "from the start" / "the per-ZIP cap", so an old
  // client with no params still gets a valid first ZIP. offset past the end
  // yields an empty window -> 404 (nothing to download), never a 200 empty zip.
  const url = new URL(request.url);
  const parseNonNeg = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const offset = parseNonNeg(url.searchParams.get("offset")) ?? 0;
  const reqLimit = parseNonNeg(url.searchParams.get("limit"));
  // The window is capped at the server's per-ZIP limit regardless of what the
  // client asks. A missing OR zero limit means "use the server cap" (a literal
  // limit=0 must never stream an empty archive), so the client never needs to
  // know the cap: it can omit limit entirely and page by the returned count.
  const windowLimit =
    reqLimit && reqLimit > 0
      ? Math.min(reqLimit, QUERY_LIMITS.showcaseCvZip)
      : QUERY_LIMITS.showcaseCvZip;

  if (offset >= allCvs.length) {
    return NextResponse.json({ error: "No CVs in this range" }, { status: 404 });
  }
  const cvs = allCvs.slice(offset, offset + windowLimit);
  if (cvs.length > QUERY_LIMITS.showcaseCvZip) {
    // Refuse loudly BEFORE any bytes stream: a silently truncated archive would
    // read as "all CVs" to a sponsor. (Unreachable given the slice above, but a
    // defensive guard so no future change can stream an oversized batch.)
    return NextResponse.json(
      {
        error: `${cvs.length} CVs exceed the per-download limit of ${QUERY_LIMITS.showcaseCvZip}.`,
      },
      { status: 413 }
    );
  }

  // Unique, filesystem-safe entry names: Lovelace_Ada_CV.pdf, _2 on collision.
  const usedNames = new Set<string>();
  const entryName = (first: string, last: string): string => {
    const base = `${slugify(last) || "cv"}_${slugify(first) || "applicant"}_CV`;
    let name = `${base}.pdf`;
    for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}.pdf`;
    usedNames.add(name);
    return name;
  };

  // PULL-based stream: one CV is fetched and zipped per pull() call, so a slow
  // or stalled client applies real backpressure (memory stays at ~one CV, never
  // the whole archive), and cancel() stops fetching the moment the client
  // disconnects instead of burning Drive quota into the void. fflate's ondata
  // is synchronous per push, so each pull enqueues that CV's chunks and returns.
  let index = 0;
  let cancelled = false;
  const included: string[] = [];
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
      // Each pull zips exactly ONE fetched CV (skipping failures until one
      // succeeds or the list is exhausted), so chunks are only produced when
      // the consumer asks for more.
      while (!cancelled && index < cvs.length) {
        const cv = cvs[index++];
        const displayName = `${cv.firstName} ${cv.lastName}`;
        try {
          const { buffer } = await downloadFile(cv.fileId);
          if (cancelled) return;
          const entry = new ZipPassThrough(entryName(cv.firstName, cv.lastName));
          zip.add(entry);
          entry.push(new Uint8Array(buffer), true);
          included.push(displayName);
          return;
        } catch (err) {
          console.error(`Showcase CV zip: failed to fetch CV for ${displayName}:`, err);
          failed.push(displayName);
        }
      }
      if (cancelled) return;
      // All CVs handled: write the manifest (a partially failed run is
      // self-describing) and finish the archive.
      const manifest = [
        `EHL Partner Showcase - CV archive`,
        `Included: ${included.length}`,
        ...included.map((n) => `  + ${n}`),
        ...(failed.length > 0
          ? [
              ``,
              `FAILED to fetch (retry later or download individually): ${failed.length}`,
              ...failed.map((n) => `  ! ${n}`),
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

  // Distinct filename per batch so sequential ZIPs never overwrite each other in
  // the browser's downloads folder (ehl-cvs.zip for the whole set / a single
  // batch, ehl-cvs-2.zip, -3.zip, ... for later batches).
  const batchNo = Math.floor(offset / QUERY_LIMITS.showcaseCvZip) + 1;
  const filename = offset > 0 ? `ehl-cvs-${batchNo}.zip` : "ehl-cvs.zip";

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Paging metadata so the client can loop offset by the CONSENTED total
      // (the server's own list length) instead of a client-side count that may
      // diverge from it — X-CV-Total is the authoritative CV count for this
      // chapter, X-CV-Window is how many this response covers.
      "X-CV-Total": String(allCvs.length),
      "X-CV-Window": String(cvs.length),
      // Personal data behind a bearer link: never cache, never index, never
      // leak the token via referrer — same hygiene as the single-CV proxy.
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });
}
