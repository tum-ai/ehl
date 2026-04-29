import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className, hover = false }: CardProps) {
  return (
    <div
      className={cn(
        "ui-card rounded-2xl border border-white/[0.06] bg-surface-card/60 p-6 backdrop-blur-sm",
        hover && "transition-all duration-300 hover:border-white/10 hover:bg-surface-card",
        className
      )}
    >
      {children}
    </div>
  );
}
