export function LimitBanner({
  count,
  limit,
  label,
}: {
  count: number;
  limit: number;
  label: string;
}) {
  if (count < limit) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Showing {limit} {label} (limit reached). There may be more data not displayed.
      Increase the limit via environment variable in Vercel Dashboard.
    </div>
  );
}
