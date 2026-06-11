import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Returns the base site URL. Uses NEXT_PUBLIC_SITE_URL env var,
 * falls back to the deployment's own URL on Vercel preview deployments
 * (so auth links in emails stay on the preview instead of pointing at
 * production), then https://ehl.gg in production or localhost in dev.
 *
 * NEXT_PUBLIC_SITE_URL is therefore scoped to Production only in Vercel.
 */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "preview") {
    const previewHost = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
    if (previewHost) return `https://${previewHost}`;
  }
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  return "https://ehl.gg";
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | null): string {
  if (!date) return "TBA";
  const d = new Date(date + "T00:00:00");
  // If day is 1, treat as "month only" (approximate date)
  if (d.getDate() === 1) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateRange(date: string | null, dateEnd: string | null): string {
  if (!date) return "TBA";
  const d = new Date(date + "T00:00:00");
  // If day is 1, treat as approximate month
  if (d.getDate() === 1) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (!dateEnd) {
    return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  }
  const dEnd = new Date(dateEnd + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${d.getDate()}-${dEnd.getDate()} ${month} ${d.getFullYear()}`;
}

export function formatDateFull(date: string | null, dateEnd?: string | null): string {
  if (!date) return "TBA";
  const d = new Date(date + "T00:00:00");
  if (d.getDate() === 1) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (!dateEnd) {
    return d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  const dEnd = new Date(dateEnd + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${d.getDate()}-${dEnd.getDate()} ${month} ${d.getFullYear()}`;
}

export function formatDeadline(deadline: string): string {
  const d = new Date(deadline);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }) + " CET";
}

export function getPlacementLabel(placement: number): string {
  const mod100 = placement % 100;
  // 11th, 12th, 13th are exceptions
  if (mod100 >= 11 && mod100 <= 13) return `${placement}th`;
  const mod10 = placement % 10;
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${placement}${suffixes[mod10] || "th"}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Validate that a redirect path is safe (internal, no open redirect).
 * Returns the path if safe, null otherwise.
 */
export function getSafeRedirect(redirectTo: string | undefined | null): string | null {
  if (!redirectTo) return null;
  // Decode to catch URL-encoded bypasses like %2F%2Fevil.com
  const decoded = decodeURIComponent(redirectTo);
  // Must start with / and not start with // or /\ (protocol-relative or backslash tricks)
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) {
    return null;
  }
  // Block any protocol:// patterns
  if (/^\/[a-z]+:/i.test(decoded)) return null;
  return decoded;
}

export function getPlacementColor(placement: number): string {
  switch (placement) {
    case 1:
      return "text-gold";
    case 2:
      return "text-silver";
    case 3:
      return "text-bronze";
    default:
      return "text-text-secondary";
  }
}
