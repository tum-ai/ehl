import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { downloadFile } from "@/lib/gdrive";
import { getShowcaseByToken } from "@/lib/actions/showcase";
import { getShowcaseCvFileId } from "@/lib/queries/showcase";
import { checkRateLimit, showcaseLimiter } from "@/lib/ratelimit";

// Token-gated CV proxy for the partner showcase.
//
// Route is keyed by application id, NOT the Google Drive fileId: Drive file ids
// stay server-side, so a partner can never learn or share a raw Drive link, and
// there is nothing to enumerate across the whole Drive. Access is granted iff:
//   1. the showcase token resolves to a LIVE showcase (enabled, unexpired), AND
//   2. that showcase's chapter has show_cvs turned on, AND
//   3. the application id belongs to THAT chapter (IDOR guard) and passes the
//      sponsor consent gate — enforced in getShowcaseCvFileId().
// Any failure returns a uniform 404 so the route is not an existence oracle.
// The CV is streamed with no-store + noindex + no-referrer so it is never cached
// by a CDN/browser and the token can't leak via referrer.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; applicationId: string }> }
) {
  const { token, applicationId } = await params;

  const notFound = () =>
    NextResponse.json({ error: "Not found" }, { status: 404 });

  // Per-IP rate limit first: blunts scripted mass-download of a leaked link and
  // brute-force enumeration of application ids.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit(showcaseLimiter, ip, "showcase-cv");
  if (rl.limited) {
    return NextResponse.json({ error: rl.error ?? "Rate limited" }, { status: 429 });
  }

  const showcase = await getShowcaseByToken(token);
  if (!showcase) return notFound();
  if (!showcase.showCvs) return notFound();

  const fileId = await getShowcaseCvFileId(showcase.chapterId, applicationId);
  if (!fileId) return notFound();

  try {
    const { buffer, mimeType } = await downloadFile(fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
        // Sponsor CVs are personal data behind a bearer link: never let a shared
        // cache/CDN or the browser retain a copy, and keep them out of any index.
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    console.error("Showcase CV proxy error:", err);
    return notFound();
  }
}
