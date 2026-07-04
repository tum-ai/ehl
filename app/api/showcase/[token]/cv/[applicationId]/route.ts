import { NextResponse } from "next/server";
import { downloadFile } from "@/lib/gdrive";
import { getShowcaseByToken } from "@/lib/actions/showcase";
import { getShowcaseCvFileId } from "@/lib/queries/showcase";

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
//
// Rate limiting lives INSIDE getShowcaseByToken (per IP), so every consumer of
// the resolver shares one bucket: a scripted mass-download or application-id
// enumeration burns the same limit as any other resolver traffic, and a request
// is never double-charged. When limited the resolver returns null and this
// route answers the uniform 404 (no rate-limit oracle either).
//
// The CV is streamed with no-store + noindex + no-referrer so it is never cached
// by a CDN/browser and the token can't leak via referrer.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; applicationId: string }> }
) {
  const { token, applicationId } = await params;
  // ?download=1 forces a save dialog (Content-Disposition: attachment); default
  // is inline so "View CV" previews in the browser.
  const download = new URL(request.url).searchParams.get("download") === "1";

  const notFound = () =>
    NextResponse.json({ error: "Not found" }, { status: 404 });

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
        "Content-Disposition": download ? "attachment" : "inline",
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
