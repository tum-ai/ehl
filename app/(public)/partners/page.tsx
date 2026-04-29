import type { Metadata } from "next";
import Image from "next/image";
import { Section, SectionTitle } from "@/components/ui/section";
import { getPartners } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Partners",
  description: "Partner with the European Hackathon League",
};

const tiers = [
  {
    name: "Challenge Partner",
    price: "Custom",
    highlight: true,
    features: [
      "Your own challenge track with dedicated teams",
      "On-stage presence during pitch & award ceremony",
      "Logo on all event materials and website",
      "Direct access to top engineering talent",
      "Jury seats to evaluate submissions",
      "Branded prizes for winning teams",
    ],
  },
  {
    name: "Tech Partner",
    price: "Custom",
    highlight: false,
    features: [
      "Technology showcase at hackathon events",
      "Logo on event materials and website",
      "API credits or tools for participants",
      "Workshop or tech talk slot",
      "Talent pipeline access",
    ],
  },
  {
    name: "Community Partner",
    price: "Custom",
    highlight: false,
    features: [
      "Cross-promotion across channels",
      "Logo on website",
      "Community access and co-branding",
      "Event presence opportunities",
    ],
  },
];

export default async function PartnersPage() {
  const partners = await getPartners();
  const challengePartners = partners.filter((p) => p.tier === "challenge_partner");
  const techPartners = partners.filter((p) => p.tier === "tech_partner");
  const communityPartners = partners.filter((p) => p.tier === "community_partner");

  return (
    <Section className="relative overflow-hidden">
      <div className="glow-blob glow-blob-purple absolute -right-40 -top-20 h-[400px] w-[400px] opacity-15" />

      <div className="relative mb-16 text-center">
        <h1 className="font-hero-display text-4xl font-black sm:text-5xl">
          <span className="shimmer-text">Partner with EHL</span>
        </h1>
        <p className="mt-3 max-w-2xl mx-auto font-hero-body text-text-secondary">
          The European Hackathon League connects top tech talent across Europe.
          Partner with us to reach the best student engineers on the continent.
        </p>
      </div>

      {/* Partnership tiers */}
      <SectionTitle>Partnership Tiers</SectionTitle>
      <div className="grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={cn(
              "relative flex flex-col overflow-hidden rounded-2xl border p-8 transition-all duration-300",
              tier.highlight
                ? "border-gold/30 bg-gradient-to-b from-gold/5 to-transparent"
                : "border-white/[0.06] bg-surface-card/50"
            )}
          >
            {tier.highlight && (
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/10 blur-3xl" />
            )}
            <div className="relative flex flex-1 flex-col">
              <h3 className={cn(
                "font-hero-display text-xl font-black",
                tier.highlight ? "text-gold" : "text-text-primary"
              )}>
                {tier.name}
              </h3>
              <p className="mt-1 text-sm text-text-muted">{tier.price}</p>

              <ul className="mt-6 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm text-text-secondary">
                    <svg className={cn("mt-0.5 h-4 w-4 shrink-0", tier.highlight ? "text-gold" : "text-purple")} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL || "contact@ehl.gg"}?subject=EHL Partnership: ${tier.name}`}
                className={cn(
                  "mt-8 block w-full rounded-full py-3 text-center font-hero-heading text-sm font-bold transition-all duration-200",
                  tier.highlight
                    ? "bg-ci-platinum text-ci-dark-amethyst hover:shadow-[0_0_20px_rgba(239,239,239,0.2)]"
                    : "border border-ci-lavender/30 bg-ci-lavender/10 text-ci-lavender hover:bg-ci-lavender/20"
                )}
              >
                Get in Touch
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Current partners */}
      {(challengePartners.length > 0 || techPartners.length > 0 || communityPartners.length > 0) && (
        <div className="mt-24">
          <SectionTitle>Current Partners</SectionTitle>

          {challengePartners.length > 0 && (
            <div className="mb-12">
              <h3 className="mb-6 text-center text-sm font-bold text-text-muted">Challenge Partners</h3>
              <div className="flex flex-wrap items-center justify-center gap-10">
                {challengePartners.map((partner) => (
                  <a
                    key={partner.id}
                    href={partner.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group transition-all duration-300 hover:drop-shadow-[0_0_12px_rgba(255,204,106,0.2)]"
                    title={partner.name}
                  >
                    <Image
                      src={partner.logoUrl}
                      alt={partner.name}
                      width={140}
                      height={48}
                      className="h-12 w-auto object-contain opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {techPartners.length > 0 && (
            <div>
              <h3 className="mb-6 text-center text-sm font-bold text-text-muted">Tech Partners</h3>
              <div className="flex flex-wrap items-center justify-center gap-8">
                {techPartners.map((partner) => (
                  <a
                    key={partner.id}
                    href={partner.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group transition-all duration-300 hover:drop-shadow-[0_0_12px_rgba(154,100,217,0.2)]"
                    title={partner.name}
                  >
                    <Image
                      src={partner.logoUrl}
                      alt={partner.name}
                      width={100}
                      height={40}
                      className="h-10 w-auto object-contain opacity-40 transition-opacity duration-300 group-hover:opacity-100"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {communityPartners.length > 0 && (
            <div className="mt-12">
              <h3 className="mb-6 text-center text-sm font-bold text-text-muted">Community Partners</h3>
              <div className="flex flex-wrap items-center justify-center gap-8">
                {communityPartners.map((partner) => (
                  <a
                    key={partner.id}
                    href={partner.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group transition-all duration-300 hover:drop-shadow-[0_0_12px_rgba(154,100,217,0.2)]"
                    title={partner.name}
                  >
                    <Image
                      src={partner.logoUrl}
                      alt={partner.name}
                      width={100}
                      height={40}
                      className="h-10 w-auto object-contain opacity-40 transition-opacity duration-300 group-hover:opacity-100"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
