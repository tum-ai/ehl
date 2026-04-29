import { cn } from "@/lib/utils";
import type { Partner } from "@/lib/types";

interface PartnerCardProps {
  partner: Partner;
  size?: "lg" | "md" | "sm";
}

export function PartnerCard({ partner, size = "md" }: PartnerCardProps) {
  return (
    <a
      href={partner.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex flex-col items-center rounded-xl border border-white/10 bg-surface-card p-6 text-center transition-all duration-200 hover:bg-surface-card-hover hover:border-white/20",
        size === "lg" && "p-8",
        size === "sm" && "p-4"
      )}
    >
      {/* Placeholder for logo — using text until real logos are available */}
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-surface px-4",
          size === "lg" ? "h-20 text-xl" : size === "sm" ? "h-10 text-sm" : "h-14 text-base"
        )}
      >
        <span className="font-medium text-text-secondary group-hover:text-text-primary transition-colors">
          {partner.name}
        </span>
      </div>
      {partner.description && size !== "sm" && (
        <p className="mt-3 text-xs text-text-muted">{partner.description}</p>
      )}
    </a>
  );
}
