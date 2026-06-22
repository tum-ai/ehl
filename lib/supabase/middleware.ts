import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session - important for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Admin routes: require admin or chapter_admin role. This is a coarse auth
  // gate; page-level guards (requireChapterAdminPage / requireGlobalAdminPage)
  // confine local admins to their single chapter.
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }

    // Check role from profiles table
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || (profile.role !== "admin" && profile.role !== "chapter_admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }

    // Confine local (chapter) admins to their single chapter + check-in. This is
    // the hard boundary; page guards are defense-in-depth. Global admins are
    // unaffected.
    if (profile.role === "chapter_admin") {
      const { data: assignment } = await supabase
        .from("chapter_admins")
        .select("chapter_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const chapterId = assignment?.chapter_id as string | undefined;
      const chapterBase = chapterId ? `/admin/chapters/${chapterId}` : null;

      const allowed =
        !!chapterBase &&
        (pathname === chapterBase ||
          pathname.startsWith(`${chapterBase}/`) ||
          pathname === "/admin/check-in" ||
          pathname.startsWith("/admin/check-in/"));

      if (!allowed) {
        const url = request.nextUrl.clone();
        url.pathname = chapterBase ?? "/admin/login";
        return NextResponse.redirect(url);
      }
    }
  }

  // Jury routes: require jury or admin role
  if (pathname.startsWith("/jury") && !pathname.startsWith("/jury/login")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/jury/login";
      return NextResponse.redirect(url);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || (profile.role !== "jury" && profile.role !== "admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/jury/login";
      return NextResponse.redirect(url);
    }
  }

  // Dashboard routes: require authenticated user
  if (pathname.startsWith("/dashboard")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
