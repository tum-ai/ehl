import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin-allowlist";
import { getSafeRedirect } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = getSafeRedirect(searchParams.get("next")) ?? "/";

  const supabase = await createClient();
  let authenticated = false;

  // PKCE flow: exchange code for session
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) authenticated = true;
  }

  // Token hash flow (magic links, invites, email verification, password recovery)
  if (!authenticated && token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as "magiclink" | "invite" | "email" | "recovery",
    });
    if (!error) authenticated = true;
  }

  if (!authenticated) {
    // Redirect to appropriate login page based on where they were going
    if (next === "/jury") {
      return NextResponse.redirect(`${origin}/jury/login?error=auth_failed`);
    }
    if (next === "/admin") {
      return NextResponse.redirect(`${origin}/admin/login?error=auth_failed`);
    }
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const email = user.email ?? "";
  const adminClient = createAdminClient();

  // If coming from admin login, verify email is on the allowlist
  if (next === "/admin") {
    if (!(await isAdminEmail(email))) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/admin/login?error=not_authorized`
      );
    }

    await adminClient.from("profiles").upsert({
      id: user.id,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      role: "admin",
    });

    return NextResponse.redirect(`${origin}/admin`);
  }

  // Check existing profile or create one
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Auto-assign role based on context
    const role = (await isAdminEmail(email))
      ? "admin"
      : next === "/jury"
        ? "jury"
        : "participant";

    await adminClient.from("profiles").upsert({
      id: user.id,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      role,
    });

    if (role === "admin") {
      return NextResponse.redirect(`${origin}/admin`);
    }
    if (role === "jury") {
      return NextResponse.redirect(`${origin}/jury`);
    }
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  const role = profile.role as string;

  // Route based on role and intended destination
  if (next === "/jury" && (role === "jury" || role === "admin")) {
    return NextResponse.redirect(`${origin}/jury`);
  }
  if (role === "admin") {
    return NextResponse.redirect(`${origin}/admin`);
  }
  if (role === "jury") {
    return NextResponse.redirect(`${origin}/jury`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
