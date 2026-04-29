import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(null, { status: 401 });
  }
  return NextResponse.json({ user: { id: session.user.id } });
}
