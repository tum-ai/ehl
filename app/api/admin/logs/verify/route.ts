import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { verifyHashChain } from "@/lib/event-log";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const result = await verifyHashChain();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 500 }
    );
  }
}
