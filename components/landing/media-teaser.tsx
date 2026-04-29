export async function MediaTeaser() {
  return (
    <section className="relative overflow-hidden px-4 pb-24 sm:px-6 lg:px-8">
      <div className="glow-blob glow-blob-purple absolute -right-40 bottom-0 h-[300px] w-[300px] opacity-20" />

      {/* Visual separator */}
      <div className="mx-auto mb-12 flex max-w-md items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-ci-lavender/30" />
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-ci-lavender/40" />
          <span className="font-hero-heading text-[10px] font-bold uppercase tracking-[0.25em] text-text-muted">
            Watch
          </span>
          <div className="h-1.5 w-1.5 rounded-full bg-ci-lavender/40" />
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-ci-lavender/30" />
      </div>

      <div className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-surface-card shadow-[0_0_60px_rgba(154,100,217,0.08)]">
          <div className="aspect-video">
            <iframe
              src="https://www.youtube.com/embed/5IzfwpVv2hQ"
              title="EHL Announcement: European Hackathon League"
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
