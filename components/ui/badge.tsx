import { cn } from "@/lib/utils";

interface BadgeProps {
  variant: "completed" | "announced" | "live" | "upcoming" | "default";
  children: React.ReactNode;
  className?: string;
  light?: boolean;
}

const variants = {
  completed: "bg-success/10 text-success border-success/20",
  announced: "bg-ci-lavender/10 text-ci-lavender border-ci-lavender/20",
  live: "bg-ci-jasmine/15 text-ci-jasmine border-ci-jasmine/25 animate-pulse",
  upcoming: "bg-white/5 text-text-muted border-white/[0.06]",
  default: "bg-white/5 text-text-secondary border-white/[0.06]",
};

const lightVariants = {
  completed: "ad-bg-success ad-text-success ad-border-success",
  announced: "ad-bg-accent ad-text-accent ad-border-strong",
  live: "ad-bg-warning ad-text-warning ad-border-warning animate-pulse",
  upcoming: "ad-bg ad-text-muted ad-border",
  default: "ad-bg ad-text-muted ad-border",
};

export function Badge({ variant, children, className, light }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 font-hero-heading text-[10px] font-bold uppercase tracking-wider",
        light ? lightVariants[variant] : variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
