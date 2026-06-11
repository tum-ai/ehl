import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin-allowlist";
import { getSafeRedirect } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = getSafeRedirect(searchParams.get("next")) ?? "/";

  // Collect cookies written by Supabase (session tokens from verifyOtp /
  // exchangeCodeForSession) and attach them explicitly to whichever redirect
  // response we return. Next.js also merges cookies() mutations into returned
  // responses, but wiring the client to the request and forwarding cookies
  // ourselves keeps the session handoff independent of that framework
  // behavior (and matches the Supabase SSR middleware pattern).
  const pendingCookies: Parameters<NextResponse["cookies"]["set"]>[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) =>
          cookies.forEach(({ name, value, options }) =>
            pendingCookies.push([name, value, options])
          ),
      },
    }
  );

  function redirectWithCookies(url: string): NextResponse {
    const response = NextResponse.redirect(url);
    pendingCookies.forEach((args) => response.cookies.set(...args));
    return response;
  }

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
    if (next === "/jury") {
      return redirectWithCookies(`${origin}/jury/login?error=auth_failed`);
    }
    if (next === "/admin") {
      return redirectWithCookies(`${origin}/admin/login?error=auth_failed`);
    }
    return redirectWithCookies(`${origin}/login?error=auth_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithCookies(`${origin}/login?error=auth_failed`);
  }

  const email = user.email ?? "";
  const adminClient = createAdminClient();

  // If coming from admin login, verify email is on the allowlist
  if (next === "/admin") {
    if (!(await isAdminEmail(email))) {
      await supabase.auth.signOut();
      return redirectWithCookies(`${origin}/admin/login?error=not_authorized`);
    }

    await adminClient.from("profiles").upsert({
      id: user.id,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      role: "admin",
    });

    return redirectWithCookies(`${origin}/admin`);
  }

  // Check existing profile or create one
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Auto-assign role: only admin (via allowlist) or participant.
    // Jury profiles are created exclusively via the inviteJury() admin action.
    const role = (await isAdminEmail(email)) ? "admin" : "participant";

    await adminClient.from("profiles").upsert({
      id: user.id,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      role,
    });

    if (role === "admin") {
      return redirectWithCookies(`${origin}/admin`);
    }
    return redirectWithCookies(`${origin}/dashboard`);
  }

  const role = profile.role as string;

  // Route based on role and intended destination
  if (next === "/jury" && (role === "jury" || role === "admin")) {
    return redirectWithCookies(`${origin}/jury`);
  }
  if (role === "admin") {
    return redirectWithCookies(`${origin}/admin`);
  }
  if (role === "jury") {
    return redirectWithCookies(`${origin}/jury`);
  }
  return redirectWithCookies(`${origin}${next}`);
}
