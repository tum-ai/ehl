import Link from "next/link";
import Image from "next/image";
import { getSession, signOutAction } from "@/lib/actions/auth";

export default async function ParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-surface-deep">
      <header className="border-b border-white/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Image
                src="/images/ehl-logo.svg"
                alt="EHL"
                width={80}
                height={40}
                className="h-8 w-auto"
              />
            </Link>
            <span className="text-xs text-text-muted">Team Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Back to site
            </Link>
            {session && (
              <>
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
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
