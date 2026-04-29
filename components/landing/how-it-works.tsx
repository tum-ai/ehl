import { Section, SectionTitle } from "@/components/ui/section";

const steps = [
  {
    number: "01",
    title: "Hack",
    subtitle: "4 Cities. 6 Hackathons.",
    description:
      "Munich, Paris, Berlin, Zurich. The league travels across Europe. At each stop, teams compete in 24-48h hackathons hosted by top universities and tech communities.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Rise",
    subtitle: "Earn Points. Climb the Ranks.",
    description:
      "Every match counts. Place in the top 5 of your challenge to earn league points. Even submitting earns you points. The leaderboard updates live across the entire season.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Win",
    subtitle: "Grand Finale in Munich.",
    description:
      "The top 15 teams qualify for the Grand Finale, a championship event where the best hackers in Europe go head-to-head for the title.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 0 1-2.02 1.272 6.023 6.023 0 0 1-2.02-1.272" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  return (
    <Section className="relative">
      {/* Background glow */}
      <div className="glow-blob glow-blob-purple absolute -left-40 top-0 h-[400px] w-[400px] opacity-10" />

      <SectionTitle>How it works</SectionTitle>
      <div className="grid gap-6 md:grid-cols-3">
        {steps.map((step, i) => (
          <div
            key={step.number}
            className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-card/40 p-8 backdrop-blur-sm transition-all duration-500 hover:border-ci-lavender/30 hover:bg-surface-card/70 hover:shadow-[0_0_40px_rgba(154,100,217,0.08)]"
          >
            {/* Top accent line */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ci-lavender/30 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            {/* Corner accents */}
            <div className="absolute top-0 left-0 h-12 w-px bg-gradient-to-b from-ci-lavender/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="absolute top-0 left-0 h-px w-12 bg-gradient-to-r from-ci-lavender/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="absolute bottom-0 right-0 h-12 w-px bg-gradient-to-t from-ci-lavender/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="absolute bottom-0 right-0 h-px w-12 bg-gradient-to-l from-ci-lavender/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            {/* Glow on hover */}
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-ci-lavender/10 blur-3xl opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

            <div className="relative">
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-ci-lavender/20 bg-ci-lavender/10 text-ci-lavender transition-all duration-500 group-hover:border-ci-lavender/40 group-hover:bg-ci-lavender/15 group-hover:shadow-[0_0_30px_rgba(154,100,217,0.2)]">
                  {step.icon}
                </div>
                <span className="gradient-text font-mono text-5xl font-black opacity-20 transition-opacity duration-500 group-hover:opacity-35">
                  {step.number}
                </span>
              </div>

              <h3 className="font-hero-display text-2xl font-black text-text-primary">
                {step.title}
              </h3>
              <p className="mt-1 font-hero-heading text-sm font-semibold text-ci-jasmine">
                {step.subtitle}
              </p>
              <p className="mt-4 font-hero-body text-sm leading-relaxed text-text-secondary">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
