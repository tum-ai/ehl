import { NextResponse } from "next/server";
import ReactPDF from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { CertificateDocument } from "@/lib/certificates/template";
import { checkRateLimit, certLimiter } from "@/lib/ratelimit";
import { getSession } from "@/lib/actions/auth";
import { verifyCertificateToken } from "@/lib/certificate-token";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chapterId: string; teamId: string }> }
) {
  const { chapterId, teamId } = await params;

  // Rate limit FIRST: PDF generation is CPU-intensive and the route is now
  // reachable unauthenticated via a capability token, so the limit must apply to
  // every path (token, session, or no-auth) before any expensive work.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(certLimiter, `cert:${ip}`);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  // Authorization: EITHER a valid capability token bound to this exact
  // (chapterId, teamId), OR a logged-in admin / member of this team.
  //
  // The token path serves the emailed certificate link to recipients who are not
  // logged in. A token authorizes only its own certificate (it is an HMAC over
  // `${chapterId}:${teamId}`), so it cannot be used to enumerate other teams.
  const token = new URL(request.url).searchParams.get("token");
  const hasValidToken = verifyCertificateToken(chapterId, teamId, token);

  const adminClient = createAdminClient();

  if (!hasValidToken) {
    // Fall back to the session-based path (admin or team member).
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const isAdmin = session.profile?.role === "admin";
    if (!isAdmin) {
      // Check if user is a member of this team
      const { data: membership } = await adminClient
        .from("team_members")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("user_id", session.user.id)
        .single();

      if (!membership) {
        return NextResponse.json({ error: "You can only download certificates for your own team." }, { status: 403 });
      }
    }
  }

  // Fetch score (must be published)
  const { data: score } = await adminClient
    .from("scores")
    .select("placement, points, challenge_name, published")
    .eq("chapter_id", chapterId)
    .eq("team_id", teamId)
    .eq("published", true)
    .single();

  if (!score) {
    return NextResponse.json({ error: "Certificate not available" }, { status: 404 });
  }

  // Fetch team
  const { data: team } = await adminClient
    .from("teams")
    .select("name, university")
    .eq("id", teamId)
    .single();

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Fetch chapter
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("name, city, country, date, date_end")
    .eq("id", chapterId)
    .single();

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  // Fetch team members
  const { data: members } = await adminClient
    .from("team_members")
    .select("profiles(name)")
    .eq("team_id", teamId);

  const memberNames = (members ?? [])
    .map((m) => {
      const profile = m.profiles as unknown as { name: string | null } | null;
      return profile?.name ?? null;
    })
    .filter((n): n is string => !!n);

  // Format date
  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const dateStr = chapter.date
    ? chapter.date_end
      ? `${formatDate(chapter.date as string)} - ${formatDate(chapter.date_end as string)}`
      : formatDate(chapter.date as string)
    : "";

  const placement = score.placement as number | null;
  const placementLabel = placement
    ? `${placement}${placement === 1 ? "st" : placement === 2 ? "nd" : placement === 3 ? "rd" : "th"} Place`
    : "Participant";

  // Generate PDF
  const pdfStream = await ReactPDF.renderToStream(
    CertificateDocument({
      teamName: team.name as string,
      university: (team.university as string) ?? null,
      memberNames,
      chapterName: chapter.name as string,
      chapterCity: `${chapter.city as string}, ${chapter.country as string}`,
      chapterDate: dateStr,
      challengeName: (score.challenge_name as string) ?? null,
      placementLabel,
      points: score.points as number,
      isPlaced: placement !== null && placement <= 5,
    })
  );

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of pdfStream) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const pdfBuffer = Buffer.concat(chunks);

  const filename = `EHL-Certificate-${(team.name as string).replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // Auth-gated, personalized PDF: never cache in shared/CDN caches, and
      // always re-fetch so a republished score isn't served stale.
      "Cache-Control": "private, no-store",
    },
  });
}
