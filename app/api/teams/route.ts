import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTeams } from "@/lib/queries";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teams = await getTeams();
  return NextResponse.json(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      university: t.university,
      city: t.city,
    }))
  );
}
