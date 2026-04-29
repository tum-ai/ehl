import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSeasonStats } from "@/lib/queries/admin-stats";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const stats = await getSeasonStats();
  return NextResponse.json(stats);
}
