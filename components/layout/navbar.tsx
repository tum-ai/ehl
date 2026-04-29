import Link from "next/link";
import Image from "next/image";
import { MobileNav } from "./mobile-nav";
import { getSession } from "@/lib/actions/auth";

export async function Navbar() {
  const session = await getSession();
  const isLoggedIn = !!session;
  const role = session?.profile?.role;

  const navLinks = [
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/matches", label: "Matches" },
    { href: "/rules", label: "Rules" },
    { href: "/partners", label: "Partners" },
  ];

  if (isLoggedIn) {
    if (role === "admin") {
      navLinks.push({ href: "/admin", label: "Dashboard" });
    } else if (role === "jury") {
      navLinks.push({ href: "/jury", label: "Jury Portal" });
    } else {
      navLinks.push({ href: "/dashboard", label: "Dashboard" });
    }
  }

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-ci-background/60 backdrop-blur-xl">
      <div className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="relative z-10 flex items-center gap-3">
          <Image
            src="/images/ehl-logo.svg"
            alt="EHL"
            width={120}
            height={60}
            className="h-8 w-auto"
          />
        </Link>

        {/* Desktop links - absolutely centered */}
        <div className="absolute inset-0 hidden items-center justify-center md:flex">
          <div className="flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-text-secondary transition-all duration-200 hover:text-text-primary hover:drop-shadow-[0_0_12px_rgba(154,100,217,0.3)] font-hero-body"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Desktop CTA + Login */}
        <div className="relative z-10 hidden items-center gap-4 md:flex">
          {isLoggedIn ? (
            <Link
              href={role === "admin" ? "/admin" : role === "jury" ? "/jury" : "/dashboard"}
              className="max-w-[120px] truncate text-sm font-medium text-text-muted transition-all duration-200 hover:text-text-primary lg:max-w-[180px]"
              title={session.profile?.name || session.user.email || ""}
            >
              {session.profile?.name || session.user.email}
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-sm font-medium text-text-muted transition-all duration-200 hover:text-text-primary"
            >
              Login
            </Link>
          )}
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-full bg-ci-platinum px-5 py-2 text-sm font-bold font-hero-heading uppercase tracking-[0.05em] text-ci-dark-amethyst transition-all duration-200 hover:shadow-[0_0_20px_rgba(239,239,239,0.2)] active:scale-[0.98]"
          >
            Register Now
          </Link>
        </div>

        {/* Mobile hamburger */}
        <MobileNav links={navLinks} isLoggedIn={isLoggedIn} userName={session?.profile?.name || session?.user.email || null} />
      </div>
    </nav>
  );
}
