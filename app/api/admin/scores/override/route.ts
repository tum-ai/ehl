import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/actions/auth";
import { logEventStrict } from "@/lib/event-log";

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
      // Optional: assign the score to a real challenge. The NAME is resolved
      // server-side from the id — never trusted from the client — so the
      // sponsor-facing "Results by Challenge" shows the actual challenge
      // instead of a hardcoded "Manual Override" label.
      challengeId?: string | null;
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

  // Resolve challenge names for any referenced challenge ids, scoped to THIS
  // chapter: a challenge id from another chapter is rejected, not silently
  // written.
  const challengeIds = [
    ...new Set(
      overrides
        .map((o) => o.challengeId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const challengeNames = new Map<string, string>();
  if (challengeIds.length > 0) {
    const { data: challengeRows, error: challengeError } = await adminClient
      .from("challenges")
      .select("id, title")
      .eq("chapter_id", chapterId)
      .in("id", challengeIds);
    if (challengeError) {
      return NextResponse.json({ error: challengeError.message }, { status: 500 });
    }
    for (const c of challengeRows ?? []) {
      challengeNames.set(c.id as string, c.title as string);
    }
    const unknown = challengeIds.filter((id) => !challengeNames.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: "Challenge does not belong to this chapter" },
        { status: 400 }
      );
    }
  }

  for (const override of overrides) {
    const challengeId = override.challengeId ?? null;
    const { error: upsertError } = await adminClient.from("scores").upsert(
      {
        chapter_id: chapterId,
        team_id: override.teamId,
        placement: override.placement,
        points: override.points,
        source: "admin_override",
        challenge_id: challengeId,
        challenge_name: challengeId
          ? challengeNames.get(challengeId)!
          : "Manual Override",
        published: false,
      },
      { onConflict: "chapter_id,team_id" }
    );

    // Only log (and report success) after a confirmed write. Logging on an
    // unchecked upsert would record an override that never persisted, leaving
    // the audit trail inconsistent with the actual DB state.
    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to save override for team ${override.teamId}: ${upsertError.message}` },
        { status: 500 }
      );
    }

    await logEventStrict({
      action: "score.overridden",
      entityType: "score",
      entityId: chapterId,
      actorId: session.user.id,
      actorType: "admin",
      delta: {
        team_id: override.teamId,
        placement: { to: override.placement },
        points: { to: override.points },
        challenge_id: { to: challengeId },
        challenge_name: {
          to: challengeId ? challengeNames.get(challengeId)! : "Manual Override",
        },
      },
    });
  }

  return NextResponse.json({ success: true });
}
