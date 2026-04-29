"use client";

import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
  description?: string;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  label,
  description,
  className,
}: ToggleProps) {
  const track = cn(
    "relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-200",
    size === "md" ? "h-6 w-11" : "h-5 w-9",
    checked ? "ad-toggle-track-on bg-purple" : "ad-toggle-track bg-white/10",
    disabled && "opacity-50 cursor-not-allowed"
  );

  const thumb = cn(
    "pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200",
    size === "md" ? "h-4 w-4" : "h-3.5 w-3.5",
    size === "md"
      ? checked
        ? "translate-x-6"
        : "translate-x-1"
      : checked
        ? "translate-x-[18px]"
        : "translate-x-[3px]",
    size === "md" ? "mt-1" : "mt-[3px]"
  );

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={track}
    >
      <span className={thumb} />
    </button>
  );

  if (!label) {
    return <span className={className}>{toggle}</span>;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border border-white/[0.06] ad-border px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary ad-text">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-text-muted ad-text-muted">{description}</p>
        )}
      </div>
      {toggle}
    </div>
  );
}
