import { cn } from "@/lib/utils";

interface BracketCardProps {
  children: React.ReactNode;
  className?: string;
  bracketColor?: "purple" | "gold";
  bracketSize?: number;
}

export function BracketCard({
  children,
  className,
  bracketColor = "purple",
  bracketSize = 24,
}: BracketCardProps) {
  const color = bracketColor === "gold" ? "border-gold" : "border-purple";

  return (
    <div className={cn("relative p-8", className)}>
      {/* Top-left corner */}
      <span
        className={cn("absolute top-0 left-0 border-t-2 border-l-2", color)}
        style={{ width: bracketSize, height: bracketSize }}
      />
      {/* Top-right corner */}
      <span
        className={cn("absolute top-0 right-0 border-t-2 border-r-2", color)}
        style={{ width: bracketSize, height: bracketSize }}
      />
      {/* Bottom-left corner */}
      <span
        className={cn("absolute bottom-0 left-0 border-b-2 border-l-2", color)}
        style={{ width: bracketSize, height: bracketSize }}
      />
      {/* Bottom-right corner */}
      <span
        className={cn(
          "absolute bottom-0 right-0 border-b-2 border-r-2",
          color
        )}
        style={{ width: bracketSize, height: bracketSize }}
      />
      {children}
    </div>
  );
}
