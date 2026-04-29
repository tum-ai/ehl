import Link from "next/link";
import { cn } from "@/lib/utils";

interface PillButtonProps {
  href: string;
  variant?: "filled" | "outline";
  children: React.ReactNode;
  className?: string;
}

const variants = {
  filled:
    "bg-ci-platinum text-ci-dark-amethyst font-bold hover:shadow-[0_0_24px_rgba(239,239,239,0.2)] active:scale-[0.98]",
  outline:
    "border border-ci-jasmine text-ci-jasmine hover:bg-ci-jasmine/10 hover:shadow-[0_0_20px_rgba(255,206,119,0.15)] active:scale-[0.98]",
};

export function PillButton({
  href,
  variant = "filled",
  children,
  className,
}: PillButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded-full px-7 py-3 text-sm font-hero-heading uppercase tracking-[0.1em] transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ci-lavender",
        variants[variant],
        className
      )}
    >
      {children}
    </Link>
  );
}
