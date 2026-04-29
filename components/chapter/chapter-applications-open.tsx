import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateRange, formatDeadline } from "@/lib/utils";
import { DeadlineCountdown } from "@/components/submission/deadline-countdown";
import type { Chapter, Partner } from "@/lib/types";

interface ChapterApplicationsOpenProps {
  chapter: Chapter;
  partners: Partner[];
}

export function ChapterApplicationsOpen({
  chapter,
  partners,
}: ChapterApplicationsOpenProps) {
  const challengePartners = partners.filter((p) => p.tier === "challenge_partner");

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-surface-card to-surface-deep p-8 sm:p-12">
        <div className="glow-blob glow-blob-purple absolute -right-20 -top-20 h-48 w-48 opacity-25" />

        <div className="relative z-10">
          <Badge variant="announced">
            {chapter.isFinale ? "Grand Finale" : "Applications Open"}
          </Badge>
          <h1 className="mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
            {chapter.name}
          </h1>
          <p className="mt-3 text-text-secondary">
            {chapter.city}, {chapter.country} &middot;{" "}
            {formatDateRange(chapter.date, chapter.dateEnd)}
          </p>
          {chapter.description && (
            <p className="mt-4 max-w-2xl font-hero-body leading-relaxed text-text-secondary">
              {chapter.description}
            </p>
          )}

          <div className="mt-8">
            <Link href={`/apply/${chapter.slug}`}>
              <Button variant="primary" size="lg">
                Apply Now
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Application deadline countdown */}
      {chapter.applicationDeadline && (
        <DeadlineCountdown
          deadline={chapter.applicationDeadline}
          label="Application Deadline"
          activeMessage="Apply before the deadline to secure your spot."
          expiredMessage="Applications have closed."
        />
      )}

      {/* What to expect */}
      <div className="mt-12">
        <h2 className="mb-6 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
          What to expect
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Compete",
              desc: "Multiple challenges from industry sponsors. Pick one and build your solution in 24h.",
            },
            {
              title: "Pitch",
              desc: "Present to a jury of experts. Every pitch is a chance to prove your team.",
            },
            {
              title: "Score",
              desc: "Top 5 placements earn league points. Every submission earns at least +2.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="group rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 transition-all duration-300 hover:border-purple/20 hover:bg-surface-card/60"
            >
              <h3 className="font-hero-heading text-lg font-bold text-purple-light">
                {item.title}
              </h3>
              <p className="mt-2 font-hero-body text-sm leading-relaxed text-text-secondary">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Challenge partners */}
      {challengePartners.length > 0 && (
        <div className="mt-12">
          <h2 className="mb-6 text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
            Challenge Partners
          </h2>
          <div className="flex flex-wrap items-center gap-8">
            {challengePartners.map((partner) => (
              <div key={partner.id} className="flex items-center">
                {partner.logoUrl ? (
                  <img
                    src={partner.logoUrl}
                    alt={partner.name}
                    className="h-10 w-auto object-contain brightness-0 invert opacity-70"
                  />
                ) : (
                  <span className="text-sm font-medium text-text-secondary">
                    {partner.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apply CTA */}
      <div className="mt-12 rounded-2xl border border-gold/15 bg-gold/5 p-8 text-center">
        <p className="text-xl font-black gradient-text">
          Applications are open
        </p>
        <p className="mt-3 text-sm text-text-secondary">
          Apply now to secure your spot. Accepted participants will receive a
          confirmation email with a QR code for check-in.
        </p>
        {chapter.applicationDeadline && (
          <p className="mt-2 text-sm font-medium text-gold">
            Deadline: {formatDeadline(chapter.applicationDeadline)}
          </p>
        )}
        <div className="mt-6">
          <Link href={`/apply/${chapter.slug}`}>
            <Button variant="primary">Apply Now</Button>
          </Link>
        </div>
      </div>

      {chapter.isFinale && (
        <div className="mt-12 rounded-2xl border border-gold/15 bg-gold/5 p-8 text-center">
          <p className="text-xl font-black gradient-text">
            Top 15 teams qualify
          </p>
          <p className="mt-3 text-sm text-text-secondary">
            The Grand Finale brings the best teams together for one final
            competition in Munich.
          </p>
        </div>
      )}
    </div>
  );
}
