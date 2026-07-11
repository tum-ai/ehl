import { NextResponse } from "next/server";
import ReactPDF from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { CertificateDocument } from "@/lib/certificates/template";
import { getCertificateBackgroundDataUri } from "@/lib/certificates/designs";
import { checkRateLimit, certLimiter } from "@/lib/ratelimit";
import { getSession } from "@/lib/actions/auth";
import {
  verifyCertificateToken,
  verifyCertificateTokenV2,
  type CertificateVariant,
} from "@/lib/certificate-token";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chapterId: string; teamId: string }> }
) {
  const { chapterId, teamId } = await params;

  // Rate limit FIRST: PDF generation is CPU-intensive and the route is
  // reachable unauthenticated via a capability token, so the limit must apply to
  // every path (token, session, or no-auth) before any expensive work.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(certLimiter, `cert:${ip}`);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get("token");
  const variantParam = searchParams.get("variant");
  const memberParam = searchParams.get("member");

  if (variantParam !== null && variantParam !== "achievement" && variantParam !== "participation") {
    return NextResponse.json({ error: "Invalid variant." }, { status: 400 });
  }

  // Authorization: EITHER a capability token bound to this exact request shape,
  // OR a logged-in admin / member of this team.
  //
  // - The DEFAULT request (no variant/member params) accepts the legacy v1
  //   token (HMAC over `${chapterId}:${teamId}`) so every certificate link
  //   already sent by email keeps working unchanged.
  // - Any request selecting a variant or member accepts ONLY a v2 token minted
  //   for that exact (member, variant) scope. A v1 token must never unlock a
  //   personal certificate or a variant it was not minted for. Emailed v2
  //   links always carry an explicit `variant` param, so verification never
  //   depends on data we have not fetched yet.
  const isDefaultRequest = variantParam === null && memberParam === null;
  let hasValidToken = false;
  if (isDefaultRequest) {
    hasValidToken = verifyCertificateToken(chapterId, teamId, token);
  } else if (variantParam !== null) {
    hasValidToken = verifyCertificateTokenV2(
      chapterId,
      teamId,
      { variant: variantParam, memberId: memberParam },
      token
    );
  }

  const adminClient = createAdminClient();

  if (!hasValidToken) {
    // Fall back to the session-based path (admin or team member). Any member of
    // the team may fetch any of the team's certificates, including another
    // member's personal one: member names are already mutually visible inside a
    // team, and the personal certificate contains nothing beyond them.
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

  const placement = score.placement as number | null;
  const isPlaced = placement !== null && placement <= 5;

  // Effective variant: explicit param, else today's behavior (achievement for
  // placed teams, participation otherwise). An explicit achievement request for
  // an unplaced team has nothing to certify.
  const variant: CertificateVariant =
    variantParam ?? (isPlaced ? "achievement" : "participation");
  if (variant === "achievement" && !isPlaced) {
    return NextResponse.json({ error: "Certificate not available" }, { status: 404 });
  }

  // Personal certificate: the named person must actually be a member of this
  // team and have a profile name to print.
  let personName: string | null = null;
  if (memberParam !== null) {
    const { data: member } = await adminClient
      .from("team_members")
      .select("user_id, profiles(name)")
      .eq("team_id", teamId)
      .eq("user_id", memberParam)
      .single();

    const profile = member?.profiles as unknown as { name: string | null } | null;
    if (!member || !profile?.name) {
      return NextResponse.json({ error: "Certificate not available" }, { status: 404 });
    }
    personName = profile.name;
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

  // Fetch team members (the personal certificate omits the member list)
  let memberNames: string[] = [];
  if (personName === null) {
    const { data: members } = await adminClient
      .from("team_members")
      .select("profiles(name)")
      .eq("team_id", teamId);

    memberNames = (members ?? [])
      .map((m) => {
        const profile = m.profiles as unknown as { name: string | null } | null;
        return profile?.name ?? null;
      })
      .filter((n): n is string => !!n);
  }

  // Custom background design, if the chapter has one for this variant. Falls
  // back to the default EHL design on any failure (never breaks an emailed link).
  const backgroundImageSrc = await getCertificateBackgroundDataUri(
    adminClient,
    chapterId,
    variant
  );

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
      variant,
      personName,
      backgroundImageSrc,
    })
  );

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of pdfStream) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const pdfBuffer = Buffer.concat(chunks);

  const awardee = personName ?? (team.name as string);
  const suffix = variant === "participation" ? "-Participation" : "";
  const filename = `EHL-Certificate${suffix}-${awardee.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;

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
