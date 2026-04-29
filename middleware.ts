import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function middleware(request: NextRequest) {
  const password = process.env.PREVIEW_PASSWORD;

  if (password) {
    const pathname = request.nextUrl.pathname;

    // Allow the preview login page and its POST action
    if (pathname === "/preview-login") {
      return NextResponse.next();
    }

    // Check cookie (timing-safe comparison)
    const cookie = request.cookies.get("preview-auth")?.value ?? "";
    if (!cookie || !safeCompare(cookie, password)) {
      const url = request.nextUrl.clone();
      url.pathname = "/preview-login";
      return NextResponse.redirect(url);
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    // Match all routes except static files and api
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
