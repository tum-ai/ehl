import Image from "next/image";
import Link from "next/link";
import { getSession, signOutAction } from "@/lib/actions/auth";

export default async function JuryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-surface-deep">
      {session && (
        <header className="border-b border-white/5">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Link href="/jury" className="flex items-center gap-3">
                <Image
                  src="/images/ehl-logo.svg"
                  alt="EHL"
                  width={120}
                  height={60}
                  className="h-8 w-auto"
                />
              </Link>
              <span className="text-xs text-text-muted">Jury Portal</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-text-secondary">
                {session.profile?.name || session.profile?.email}
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-sm text-text-muted hover:text-text-secondary transition-colors"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </header>
      )}
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
