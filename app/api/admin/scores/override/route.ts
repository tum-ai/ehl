import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/actions/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { chapterId, overrides } = body as {
    chapterId: string;
    overrides: Array<{
      teamId: string;
      placement: number | null;
      points: number;
    }>;
  };

  if (!chapterId || !overrides?.length) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  // Validate score values against league rules
  for (const override of overrides) {
    if (!override.teamId || typeof override.points !== "number") {
      return NextResponse.json({ error: "Invalid override data" }, { status: 400 });
    }
    if (override.points < 0 || override.points > 8) {
      return NextResponse.json(
        { error: `Points must be between 0 and 8 (got ${override.points})` },
        { status: 400 }
      );
    }
    if (override.placement !== null) {
      if (!Number.isInteger(override.placement) || override.placement < 1 || override.placement > 5) {
        return NextResponse.json(
          { error: `Placement must be 1-5 or null (got ${override.placement})` },
          { status: 400 }
        );
      }
    }
  }

  const adminClient = createAdminClient();

  for (const override of overrides) {
    // Fetch previous score for audit trail
    const { data: previous } = await adminClient
      .from("scores")
      .select("placement, points, source")
      .eq("chapter_id", chapterId)
      .eq("team_id", override.teamId)
      .single();

    await adminClient.from("scores").upsert(
      {
        chapter_id: chapterId,
        team_id: override.teamId,
        placement: override.placement,
        points: override.points,
        source: "admin_override",
        challenge_name: "Manual Override",
        published: false,
      },
      { onConflict: "chapter_id,team_id" }
    );

    // Audit log
    await adminClient.from("admin_audit_log").insert({
      action: "score_override",
      entity_type: "score",
      entity_id: null,
      performed_by: session.user.id,
      details: {
        chapter_id: chapterId,
        team_id: override.teamId,
        previous: previous
          ? { placement: previous.placement, points: previous.points, source: previous.source }
          : null,
        new: { placement: override.placement, points: override.points },
      },
    });
  }

  return NextResponse.json({ success: true });
}
