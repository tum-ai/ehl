import Image from "next/image";
import { Button } from "@/components/ui/button";
import { getChapterStats } from "@/lib/queries";

export async function Hero() {
  const { totalMatches, cities } = await getChapterStats();

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 text-center">
      {/* ── Noise texture ── */}
      <div className="noise absolute inset-0" />

      {/* ── Ambient glow blobs (bigger, more dramatic) ── */}
      <div className="glow-blob glow-blob-purple animate-glow-pulse -left-60 -top-60 h-[800px] w-[800px]" />
      <div className="glow-blob glow-blob-gold animate-glow-pulse -right-40 top-1/4 h-[600px] w-[600px]" style={{ animationDelay: "2s" }} />
      <div className="glow-blob glow-blob-purple animate-glow-pulse -bottom-60 left-1/3 h-[500px] w-[500px]" style={{ animationDelay: "3s" }} />

      {/* ── Scanning line effect ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scan-line bg-gradient-to-r from-transparent via-gold/20 to-transparent" />

      {/* ── Grid overlay ── */}
      <div className="absolute inset-0 bg-grid opacity-40" />

      {/* ── Radial fade for depth ── */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--color-surface-deep)_70%)]" />

      {/* ── Top vignette ── */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-surface-deep to-transparent" />

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo with float animation */}
        <div className="animate-fade-in mb-8">
          <div className="animate-float">
            <Image
              src="/images/ehl-logo.svg"
              alt="European Hackathon League"
              width={400}
              height={200}
              className="h-28 w-auto drop-shadow-[0_0_60px_rgba(255,204,106,0.15)] sm:h-36 lg:h-48"
              priority
            />
          </div>
        </div>

        {/* Wordmark with letter-spacing */}
        <h1 className="animate-fade-in-up text-sm font-bold uppercase tracking-[0.35em] text-text-secondary sm:text-base lg:text-lg" style={{ animationDelay: "0.2s" }}>
          European Hackathon League
        </h1>

        {/* Divider line */}
        <div className="animate-fade-in-up mt-6 h-px w-24 bg-gradient-to-r from-transparent via-purple/50 to-transparent" style={{ animationDelay: "0.3s" }} />

        {/* Tagline with shimmer on "hackathon league" */}
        <p className="animate-fade-in-up mt-6 max-w-2xl text-3xl font-bold text-text-primary sm:text-4xl lg:text-5xl lg:leading-tight" style={{ animationDelay: "0.4s" }}>
          Europe&apos;s first competitive{" "}
          <span className="shimmer-text">hackathon league</span>
        </p>

        <p className="animate-fade-in-up mt-4 max-w-lg text-base text-text-secondary sm:text-lg" style={{ animationDelay: "0.5s" }}>
          {totalMatches} matches. {cities} cities. One champion.
        </p>

        {/* CTAs */}
        <div className="animate-fade-in-up mt-10 flex flex-col gap-4 sm:flex-row" style={{ animationDelay: "0.7s" }}>
          <Button href="/leaderboard" variant="primary" size="lg">
            View Leaderboard
          </Button>
          <Button href="/matches" variant="secondary" size="lg">
            Explore Matches
          </Button>
        </div>

        {/* Founded by TUM.ai */}
        <a
          href="https://tum-ai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="animate-fade-in mt-8 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-xs text-text-muted transition-all hover:border-purple/20 hover:bg-purple/5"
          style={{ animationDelay: "1s" }}
        >
          Founded by
          <span className="font-bold tracking-wide text-purple">TUM.ai</span>
        </a>
      </div>

      {/* ── Bottom gradient fade ── */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-surface-deep to-transparent" />
    </section>
  );
}
