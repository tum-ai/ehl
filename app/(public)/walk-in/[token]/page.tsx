import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { WalkInForm } from "@/components/application/walk-in-form";
import { getWalkInChapterByToken } from "@/lib/actions/walk-in";
import { getSession } from "@/lib/actions/auth";

interface PageProps {
  params: Promise<{ token: string }>;
}

// The walk-in token gates a live, event-day flow. It must never be statically
// cached: the page resolves the chapter fresh on every request and 404s on an
// invalid/rotated token.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Walk-In Registration",
  robots: { index: false, follow: false },
};

export default async function WalkInPage({ params }: PageProps) {
  const { token } = await params;
  const chapter = await getWalkInChapterByToken(token);

  if (!chapter) {
    notFound();
  }

  // A signed-in participant reuses their existing account: the form prefills and
  // locks their email and drops the password fields (the server reuses the
  // authenticated session, no password needed). A logged-out walk-in creates a
  // new account as before.
  const session = await getSession();
  const signedInEmail = session?.user?.email ?? null;

  return (
    <Section>
      <WalkInForm
        walkInToken={token}
        chapterId={chapter.id}
        chapterName={chapter.name}
        signedInEmail={signedInEmail}
      />
    </Section>
  );
}
