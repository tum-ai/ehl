import { cn, getPlacementLabel } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/types";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
}

const rankColors: Record<number, string> = {
  1: "text-ci-jasmine",
  2: "text-silver",
  3: "text-bronze",
};

const rankRowStyles: Record<number, string> = {
  1: "border-l-2 border-l-ci-jasmine/40 bg-ci-jasmine/[0.03]",
  2: "border-l-2 border-l-silver/30 bg-silver/[0.02]",
  3: "border-l-2 border-l-bronze/30 bg-bronze/[0.02]",
};

export function LeaderboardTable({ entries }: LeaderboardTableProps) {
  return (
    <div className="relative overflow-x-auto rounded-2xl border border-white/[0.06] bg-surface-card/40 backdrop-blur-sm">
      {/* Top accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ci-lavender/20 to-transparent" />

      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.06] text-left font-hero-heading text-xs font-bold uppercase tracking-wider text-text-muted">
            <th className="px-3 py-4 sm:px-6">Rank</th>
            <th className="px-3 py-4 sm:px-6">Team</th>
            <th className="hidden px-6 py-4 sm:table-cell">Origin</th>
            <th className="hidden px-6 py-4 text-center sm:table-cell">Matches</th>
            <th className="hidden px-6 py-4 text-center sm:table-cell">Best</th>
            <th className="px-3 py-4 text-right sm:px-6">Points</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.team.id}
              className={cn(
                "group border-b border-white/[0.03] transition-colors duration-200 hover:bg-white/[0.03]",
                rankRowStyles[entry.rank]
              )}
            >
              <td className="px-3 py-4 sm:px-6">
                <span className={cn("font-mono font-black", rankColors[entry.rank] || "text-text-muted")}>
                  {entry.rank}
                </span>
              </td>
              <td className="px-3 py-4 sm:px-6">
                <span className="font-hero-display font-bold text-text-primary transition-colors duration-200 group-hover:text-ci-jasmine">
                  {entry.team.name}
                </span>
              </td>
              <td className="hidden px-6 py-4 text-sm text-text-muted sm:table-cell">
                {entry.team.university || "-"}
              </td>
              <td className="hidden px-6 py-4 text-center font-mono text-sm text-text-secondary sm:table-cell">
                {entry.matchesPlayed}
              </td>
              <td className="hidden px-6 py-4 text-center text-sm text-text-secondary sm:table-cell">
                {entry.bestFinish ? getPlacementLabel(entry.bestFinish) : "-"}
              </td>
              <td className="px-3 py-4 text-right sm:px-6">
                <span className={cn("font-mono text-lg font-black", rankColors[entry.rank] || "text-ci-jasmine/70")}>
                  {entry.totalPoints}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
