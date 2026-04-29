import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import { fetchAvailableModels } from "@/lib/code-review/openrouter";

export async function GET() {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const models = await fetchAvailableModels();
    return NextResponse.json(models);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
