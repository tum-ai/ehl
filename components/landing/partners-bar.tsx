import Link from "next/link";
import Image from "next/image";
import { Section, SectionTitle } from "@/components/ui/section";
import { getPartners } from "@/lib/queries";

export async function PartnersBar() {
  const partners = await getPartners();

  if (partners.length === 0) return null;

  return (
    <Section className="relative overflow-hidden border-t border-white/[0.04]">
      {/* Subtle ambient glow */}
      <div className="glow-blob glow-blob-purple absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 opacity-10" />

      <SectionTitle>Partners</SectionTitle>

      {/* Marquee with edge fades */}
      <div className="relative">
        {/* Left fade */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-surface-deep to-transparent" />
        {/* Right fade */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-surface-deep to-transparent" />

        <div className="overflow-hidden">
          <div className="marquee-track">
            {/* Render partners twice for seamless loop */}
            {[...partners, ...partners].map((partner, i) => (
              <a
                key={`${partner.id}-${i}`}
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex-shrink-0 transition-all duration-300 hover:drop-shadow-[0_0_16px_rgba(154,100,217,0.25)]"
                title={partner.name}
              >
                <Image
                  src={partner.logoUrl}
                  alt={partner.name}
                  width={140}
                  height={48}
                  className="h-7 w-auto object-contain opacity-60 grayscale transition-all duration-500 group-hover:opacity-100 group-hover:grayscale-0"
                />
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-12 text-center">
        <Link
          href="/partners"
          className="group inline-flex items-center gap-2 font-hero-heading text-sm font-medium text-ci-jasmine transition-all duration-300 hover:text-ci-platinum hover:drop-shadow-[0_0_12px_rgba(255,206,119,0.3)]"
        >
          Become a partner
          <svg className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    </Section>
  );
}
