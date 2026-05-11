import Link from "next/link";
import { getChapters } from "@/lib/queries";
import { formatDateRange } from "@/lib/utils";

export async function ApplicationBanner() {
  const chapters = await getChapters();
  const openChapters = chapters.filter((c) => c.status === "applications_open");

  if (openChapters.length === 0) return null;

  return (
    <div className="relative z-20 -mt-4 mb-8 px-4">
      <div className="mx-auto max-w-4xl space-y-3">
        {openChapters.map((chapter) => (
          <Link
            key={chapter.id}
            href={`/apply/${chapter.slug}`}
            className="group block overflow-hidden rounded-2xl border border-ci-jasmine/20 bg-gradient-to-r from-ci-jasmine/10 via-ci-jasmine/5 to-transparent transition-all duration-300 hover:border-ci-jasmine/40 hover:shadow-[0_0_40px_rgba(232,184,75,0.1)]"
          >
            <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ci-jasmine/15">
                  <svg className="h-5 w-5 text-ci-jasmine" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-text-primary">
                    Applications open for {chapter.name}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {chapter.city}, {chapter.country} &middot; {formatDateRange(chapter.date, chapter.dateEnd)}
                  </p>
                </div>
              </div>
              <span className="hidden shrink-0 rounded-full bg-ci-platinum px-5 py-2 text-sm font-bold font-hero-heading uppercase tracking-[0.05em] text-ci-dark-amethyst transition-all group-hover:shadow-[0_0_20px_rgba(239,239,239,0.2)] sm:block">
                Apply Now
              </span>
              <svg className="h-5 w-5 shrink-0 text-ci-jasmine transition-transform group-hover:translate-x-1 sm:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
