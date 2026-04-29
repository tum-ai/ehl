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
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      Showing {limit} {label} (limit reached). Some results may not be displayed.
    </div>
  );
}
