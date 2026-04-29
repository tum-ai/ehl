import { NextResponse } from "next/server";
import { getClient } from "@/lib/queries/client";

// Lightweight endpoint for auto-refresh polling.
// Returns a hash that changes when data updates (~50 bytes).
// Cached for 15s on the edge to reduce DB load.
export async function GET() {
  const supabase = getClient();

  // Query the most volatile signals: chapter statuses + latest score publication
  const [chaptersResult, scoresResult] = await Promise.all([
    supabase
      .from("chapters")
      .select("id, status")
      .order("match_number", { ascending: true }),
    supabase
      .from("scores")
      .select("published_at")
      .eq("published", true)
      .order("published_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const fingerprint = [
    // All chapter statuses concatenated
    (chaptersResult.data ?? []).map((c) => `${c.id}:${c.status}`).join(","),
    // Latest score publication timestamp
    scoresResult.data?.published_at ?? "",
  ].join("|");

  // Simple hash
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = ((hash << 5) - hash + fingerprint.charCodeAt(i)) | 0;
  }

  return NextResponse.json(
    { v: hash.toString(36) },
    {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15",
      },
    }
  );
}
