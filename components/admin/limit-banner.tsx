/**
 * "You are not seeing everything" banner.
 *
 * Prefer passing `truncated` from the query. Inferring it from `count >= limit`
 * cannot see PostgREST's server-side `max_rows` ceiling (1000 by default): when
 * a configured limit is raised ABOVE that ceiling, every response stops at 1000
 * rows while this banner stays silent, because 1000 < 25000. Silent truncation
 * is the exact outcome this component exists to prevent, so any query whose
 * limit exceeds the ceiling must page (lib/queries/paged.ts) and report
 * `truncated` as a fact.
 *
 * The count/limit form is kept for call sites whose limit is still safely below
 * the ceiling, where the inference does hold.
 */
export function LimitBanner({
  count,
  limit,
  truncated,
  label,
}: {
  count?: number;
  limit?: number;
  /** Authoritative: rows were actually left unread. Overrides count/limit. */
  truncated?: boolean;
  label: string;
}) {
  const shown = count ?? limit ?? 0;
  const isTruncated =
    truncated ?? (count !== undefined && limit !== undefined && count >= limit);

  if (!isTruncated) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Showing the first {shown.toLocaleString()} {label}. More exist and are not
      displayed. Raise the limit via its environment variable in the Vercel
      dashboard, then reload.
    </div>
  );
}
