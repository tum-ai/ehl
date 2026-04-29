import { cn } from "@/lib/utils";
import Link from "next/link";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  href?: string;
}

const variants = {
  primary:
    "bg-ci-platinum text-ci-dark-amethyst font-bold hover:shadow-[0_0_30px_rgba(239,239,239,0.2)] active:scale-[0.98]",
  secondary:
    "border border-ci-lavender/50 text-ci-lavender font-medium hover:bg-ci-lavender/10 hover:border-ci-lavender hover:shadow-[0_0_20px_rgba(154,100,217,0.15)]",
  ghost:
    "text-text-secondary font-medium hover:text-text-primary hover:bg-white/5",
  danger:
    "text-error font-medium border border-error/20 hover:bg-error/10 hover:border-error/30",
};

const sizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-2.5 text-sm",
  lg: "px-8 py-3.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  href,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center rounded-full font-hero-heading font-medium transition-all duration-200 cursor-pointer",
    variants[variant],
    sizes[size],
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
