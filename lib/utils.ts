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

/**
 * Parse a DB date value. Date-only strings get T00:00:00 appended (avoids the
 * UTC-midnight timezone shift); full timestamps (timestamptz columns like
 * submitted_at) are parsed as-is — appending would produce Invalid Date.
 */
function parseDbDate(date: string): Date {
  return new Date(date.includes("T") ? date : date + "T00:00:00");
}

/** The "day 1 = approximate month" convention only applies to date-only values. */
function isApproximateMonth(date: string, d: Date): boolean {
  return !date.includes("T") && d.getDate() === 1;
}

export function formatDate(date: string | null): string {
  if (!date) return "TBA";
  const d = parseDbDate(date);
  if (isApproximateMonth(date, d)) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateRange(date: string | null, dateEnd: string | null): string {
  if (!date) return "TBA";
  const d = parseDbDate(date);
  if (isApproximateMonth(date, d)) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (!dateEnd) {
    return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  }
  const dEnd = parseDbDate(dateEnd);
  // Cross-month / cross-year ranges must name both months (and both years)
  // rather than collapsing to the start month, e.g. "30 May - 1 June 2026".
  if (d.getMonth() !== dEnd.getMonth() || d.getFullYear() !== dEnd.getFullYear()) {
    return `${formatDayMonth(d, dEnd)} ${dEnd.getFullYear()}`;
  }
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${d.getDate()}-${dEnd.getDate()} ${month} ${d.getFullYear()}`;
}

/**
 * "30 May - 1 June" style for a range crossing a month boundary. Includes the
 * year on the start side only when the years differ.
 */
function formatDayMonth(d: Date, dEnd: Date): string {
  const startMonth = d.toLocaleDateString("en-US", { month: "long" });
  const endMonth = dEnd.toLocaleDateString("en-US", { month: "long" });
  if (d.getFullYear() !== dEnd.getFullYear()) {
    return `${d.getDate()} ${startMonth} ${d.getFullYear()} - ${dEnd.getDate()} ${endMonth}`;
  }
  return `${d.getDate()} ${startMonth} - ${dEnd.getDate()} ${endMonth}`;
}

export function formatDateFull(date: string | null, dateEnd?: string | null): string {
  if (!date) return "TBA";
  const d = parseDbDate(date);
  if (isApproximateMonth(date, d)) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (!dateEnd) {
    return d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  const dEnd = parseDbDate(dateEnd);
  if (d.getMonth() !== dEnd.getMonth() || d.getFullYear() !== dEnd.getFullYear()) {
    return `${formatDayMonth(d, dEnd)} ${dEnd.getFullYear()}`;
  }
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
  let decoded: string;
  try {
    decoded = decodeURIComponent(redirectTo);
  } catch {
    // Malformed percent-encoding (e.g. a lone "%") must not throw — this runs
    // on the auth callback and would 500 the login instead of falling back.
    return null;
  }
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
