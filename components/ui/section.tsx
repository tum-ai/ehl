import { cn } from "@/lib/utils";

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function Section({ children, className, id }: SectionProps) {
  return (
    <section id={id} className={cn("py-24 px-4 sm:px-6 lg:px-8", className)}>
      <div className="mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

export function SectionTitle({
  children,
  className,
  align = "center",
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * "center" (default): symmetric divider lines around a centered heading.
   * "left": heading leads, a single divider line trails — the in-page section
   * style used by content views (chapter results, partner showcase).
   */
  align?: "center" | "left";
}) {
  if (align === "left") {
    return (
      <div className={cn("mb-6 flex items-center gap-3", className)}>
        <div className="h-px w-8 bg-gradient-to-r from-transparent to-ci-lavender/40" />
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-text-muted font-hero-body">
          {children}
        </h2>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-ci-lavender/20" />
      </div>
    );
  }
  return (
    <div className={cn("mb-14 flex items-center justify-center gap-4", className)}>
      <div className="h-px w-12 bg-gradient-to-r from-transparent to-ci-lavender/40" />
      <h2 className="text-center text-xs font-bold uppercase tracking-[0.25em] text-text-muted font-hero-body">
        {children}
      </h2>
      <div className="h-px w-12 bg-gradient-to-l from-transparent to-ci-lavender/40" />
    </div>
  );
}
