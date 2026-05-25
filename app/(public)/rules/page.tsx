import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { PLACEMENT_POINTS, PARTICIPATION_POINTS } from "@/lib/scoring";
import { getPlacementLabel, cn } from "@/lib/utils";
import { getChapterStats } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Rules",
  description: "Rules & Scoring for the European Hackathon League",
};

// ── Visual: Team Structure ──────────────────────────────────
function TeamStructureDiagram() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-purple/10 blur-3xl" />

      <h3 className="mb-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
        Team Structure
      </h3>

      <div className="flex flex-col items-center gap-4">
        {/* President */}
        <div className="relative">
          <div className="flex flex-col items-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/40 bg-gradient-to-br from-gold/15 to-gold/5">
              <svg className="h-7 w-7 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            </div>
            <span className="mt-2 text-sm font-bold text-gold">President</span>
            <span className="text-[10px] text-text-muted">Manages roster & registrations</span>
          </div>
        </div>

        {/* Connecting line */}
        <div className="h-6 w-px bg-gradient-to-b from-gold/30 to-purple/30" />

        {/* Members */}
        <div className="flex flex-wrap items-start justify-center gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center">
              <div className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full border",
                i <= 1
                  ? "border-purple/30 bg-purple/10"
                  : "border-white/10 bg-white/5 border-dashed"
              )}>
                <svg className={cn("h-5 w-5", i <= 1 ? "text-purple-light" : "text-text-muted/40")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                </svg>
              </div>
              <span className={cn("mt-1.5 text-[10px]", i <= 1 ? "text-text-secondary" : "text-text-muted/40")}>
                {i <= 1 ? `Member ${i}` : "Optional"}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-2 rounded-lg bg-purple/5 px-4 py-2 text-center text-xs text-text-muted">
          2-5 members per team. President must attend every match. Roster can change between matches.
        </div>
      </div>
    </div>
  );
}

// ── Visual: Scoring Breakdown ───────────────────────────────
function ScoringDiagram() {
  const placements = [
    { place: 1, pts: PLACEMENT_POINTS[1], color: "gold", width: "w-full" },
    { place: 2, pts: PLACEMENT_POINTS[2], color: "silver", width: "w-[87%]" },
    { place: 3, pts: PLACEMENT_POINTS[3], color: "bronze", width: "w-[75%]" },
    { place: 4, pts: PLACEMENT_POINTS[4], color: "purple", width: "w-[50%]" },
    { place: 5, pts: PLACEMENT_POINTS[5], color: "purple", width: "w-[50%]" },
  ];

  const barColors: Record<string, string> = {
    gold: "bg-gradient-to-r from-gold/30 to-gold/10 border-gold/30 text-gold",
    silver: "bg-gradient-to-r from-silver/25 to-silver/8 border-silver/25 text-silver",
    bronze: "bg-gradient-to-r from-bronze/25 to-bronze/8 border-bronze/25 text-bronze",
    purple: "bg-gradient-to-r from-purple/20 to-purple/5 border-purple/20 text-purple-light",
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
      <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-gold/10 blur-3xl" />

      <h3 className="mb-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
        Points per Match
      </h3>

      <div className="relative space-y-2.5">
        {placements.map(({ place, pts, color, width }) => (
          <div key={place} className="flex items-center gap-3">
            <span className="w-8 text-right text-xs font-bold text-text-muted">
              {getPlacementLabel(place)}
            </span>
            <div className={cn("flex items-center rounded-lg border px-3 py-2", width, barColors[color])}>
              <span className="font-mono text-sm font-black">+{pts}</span>
            </div>
          </div>
        ))}

        {/* Participation */}
        <div className="flex items-center gap-3">
          <span className="w-8 text-right text-xs font-bold text-text-muted">
            Sub
          </span>
          <div className="flex w-[25%] items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span className="font-mono text-sm font-bold text-text-secondary">+{PARTICIPATION_POINTS}</span>
          </div>
        </div>

        {/* No submit */}
        <div className="flex items-center gap-3">
          <span className="w-8 text-right text-xs font-bold text-text-muted/50">
            ---
          </span>
          <div className="flex w-[8%] min-w-12 items-center rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <span className="font-mono text-sm text-text-muted">0</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Visual: Season Flow ─────────────────────────────────────
function SeasonFlowDiagram({ totalMatches, totalCities }: { totalMatches: number; totalCities: number }) {
  const steps = [
    { label: "Register Team", desc: "Form a team of 2-5 members", icon: "team", color: "purple" as const },
    { label: `${totalMatches} Matches`, desc: `Compete across ${totalCities} European cities`, icon: "hack", color: "purple" as const },
    { label: "Earn Points", desc: "Top 5 placements score points", icon: "points", color: "gold" as const },
    { label: "Top 15 Qualify", desc: "Season leaderboard ranking", icon: "qualify", color: "gold" as const },
    { label: "Grand Finale", desc: "Championship in Munich", icon: "trophy", color: "gold" as const },
  ];

  const stepIcons: Record<string, React.ReactNode> = {
    team: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    hack: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    points: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    qualify: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    trophy: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0116.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.02 1.272 6.023 6.023 0 01-2.02-1.272" />
      </svg>
    ),
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
      <h3 className="mb-8 text-center text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
        Season Overview
      </h3>

      {/* Centered vertical timeline */}
      <div className="mx-auto max-w-xs">
        {steps.map((step, i) => (
          <div key={step.label} className="relative flex items-start gap-4">
            {/* Vertical line */}
            {i < steps.length - 1 && (
              <div className="absolute left-5 top-10 bottom-0 w-px bg-gradient-to-b from-purple/30 to-gold/20" />
            )}
            {/* Icon node */}
            <div className={cn(
              "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
              step.color === "gold"
                ? "border-gold/30 bg-gold/10 text-gold"
                : "border-purple/30 bg-purple/10 text-purple-light"
            )}>
              {stepIcons[step.icon]}
            </div>
            {/* Label */}
            <div className={cn("pb-6", i === steps.length - 1 && "pb-0")}>
              <p className="text-sm font-bold text-text-primary">{step.label}</p>
              <p className="text-[11px] text-text-muted">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function RulesPage() {
  const { totalMatches, cities } = await getChapterStats();
  return (
    <Section className="relative overflow-hidden">
      {/* Ambient glow */}
      <div className="glow-blob glow-blob-purple absolute -right-40 -top-20 h-[400px] w-[400px] opacity-10" />
      <div className="glow-blob glow-blob-gold absolute -left-40 top-2/3 h-[300px] w-[300px] opacity-10" />

      {/* Noise texture */}
      <div className="noise absolute inset-0" />

      <div className="relative mb-12 text-center">
        <h1 className="font-hero-display text-4xl font-black sm:text-5xl">
          <span className="shimmer-text">Rules & Scoring</span>
        </h1>
        <p className="mt-3 font-hero-body text-text-secondary">
          Everything you need to know about the European Hackathon League
        </p>
      </div>

      {/* Visual diagrams */}
      <div className="relative mb-16 grid gap-6 lg:grid-cols-3">
        <SeasonFlowDiagram totalMatches={totalMatches} totalCities={cities} />
        <TeamStructureDiagram />
        <ScoringDiagram />
      </div>

      {/* Detailed rules, always visible */}
      <div className="relative space-y-8">
        {/* Team Formation */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
          <h3 className="mb-4 font-hero-heading text-lg font-bold text-text-primary">Team Formation</h3>
          <div className="space-y-3 font-hero-body text-sm leading-relaxed text-text-secondary">
            <p>
              Each team consists of 2-5 members. One member is designated as the
              Team President, who manages the roster and handles all registrations.
            </p>
            <p>
              Rosters can change between matches. The president can sign up with
              different team members for each event. However, keeping a consistent
              roster is rewarded through the loyalty bonus system.
            </p>
            <p>
              <strong className="text-text-primary">The team president must be present at each match</strong> for
              the team&apos;s results to count. Without the president, no points are awarded.
            </p>
            <p>
              Teams from the inaugural Makeathon are automatically enrolled in the
              EHL.
            </p>
          </div>
        </div>

        {/* Scoring System */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
          <h3 className="mb-4 font-hero-heading text-lg font-bold text-text-primary">Scoring System</h3>
          <div className="space-y-4 font-hero-body text-sm leading-relaxed text-text-secondary">
            <p>
              Each match awards points based on your team&apos;s
              placement within your chosen challenge. Each team participates in
              exactly one challenge per match.
            </p>
            <div className="space-y-2">
              {Object.entries(PLACEMENT_POINTS).map(([place, pts]) => (
                <div
                  key={place}
                  className="flex items-center justify-between rounded-lg bg-surface-deep/60 px-4 py-2"
                >
                  <span>{getPlacementLabel(Number(place))} Place</span>
                  <span className="font-mono font-bold text-gold">+{pts}</span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg bg-surface-deep/60 px-4 py-2">
                <span>Participate &amp; Submit</span>
                <span className="font-mono font-bold text-gold">
                  +{PARTICIPATION_POINTS}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-surface-deep/60 px-4 py-2">
                <span>No Submission</span>
                <span className="font-mono font-bold text-text-muted">0</span>
              </div>
            </div>
            <p className="text-text-muted">
              Total Points = Sum of all match points + loyalty bonus
            </p>
          </div>
        </div>

        {/* Loyalty Bonus */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
          <h3 className="mb-4 font-hero-heading text-lg font-bold text-text-primary">Loyalty Bonus</h3>
          <div className="space-y-3 font-hero-body text-sm leading-relaxed text-text-secondary">
            <p>
              Teams that maintain a consistent roster across multiple matches earn
              bonus points:
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-purple/10 px-4 py-3">
                <div>
                  <p className="font-medium text-text-primary">3-Match Bonus</p>
                  <p className="text-text-muted">
                    Same roster across 3 matches in at least 2 different countries
                  </p>
                </div>
                <span className="font-mono text-lg font-bold text-purple-light">
                  +6
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-purple/10 px-4 py-3">
                <div>
                  <p className="font-medium text-text-primary">Full Season Bonus</p>
                  <p className="text-text-muted">
                    Same roster across the entire season
                  </p>
                </div>
                <span className="font-mono text-lg font-bold text-purple-light">
                  +10
                </span>
              </div>
            </div>
            <p className="text-text-muted">
              The full season bonus replaces the 3-match bonus (they do not stack).
            </p>
          </div>
        </div>

        {/* Registration */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
          <h3 className="mb-4 font-hero-heading text-lg font-bold text-text-primary">Registration</h3>
          <div className="space-y-3 font-hero-body text-sm leading-relaxed text-text-secondary">
            <p>Registration for the EHL is a two-step process:</p>
            <ol className="list-inside list-decimal space-y-2">
              <li>
                <strong className="text-text-primary">League Registration:</strong> Register your team for the
                European Hackathon League. This is a one-time step.
              </li>
              <li>
                <strong className="text-text-primary">Match Sign-up:</strong> For each match, your team must be
                unlocked by the organizers and then choose a challenge to compete in.
              </li>
            </ol>
          </div>
        </div>

        {/* Grand Finale */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
          <h3 className="mb-4 font-hero-heading text-lg font-bold text-text-primary">Grand Finale</h3>
          <div className="space-y-3 font-hero-body text-sm leading-relaxed text-text-secondary">
            <p>
              The top 15 teams from the regular season leaderboard qualify for the
              Grand Finale in Munich.
            </p>
            <p>
              The Finale is a special event where qualified teams compete for the
              championship title. Format and details will be announced as the
              season progresses.
            </p>
          </div>
        </div>

        {/* Code of Conduct */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8">
          <h3 className="mb-4 font-hero-heading text-lg font-bold text-text-primary">Code of Conduct</h3>
          <div className="space-y-3 font-hero-body text-sm leading-relaxed text-text-secondary">
            <p>
              All participants are expected to maintain a respectful and inclusive
              environment. The EHL follows the principles of fair play, collaboration,
              and sportsmanship.
            </p>
            <p>
              Cheating, plagiarism, or any form of misconduct will result in
              disqualification. The organizers reserve the right to make final
              decisions on any disputes.
            </p>
          </div>
        </div>

        {/* Questions */}
        <div className="rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6 sm:p-8 text-center">
          <h3 className="mb-3 font-hero-heading text-lg font-bold text-text-primary">Questions?</h3>
          <p className="font-hero-body text-sm text-text-secondary">
            If you have any questions about the rules, scoring, or anything else, reach out to us.
          </p>
          <a
            href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL || "contact@ehl.gg"}?subject=EHL Question`}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-purple/30 bg-purple/10 px-6 py-2.5 font-hero-body text-sm font-medium text-purple-light transition-all hover:border-purple/50 hover:bg-purple/20"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            {process.env.NEXT_PUBLIC_CONTACT_EMAIL || "contact@ehl.gg"}
          </a>
        </div>
      </div>
    </Section>
  );
}
