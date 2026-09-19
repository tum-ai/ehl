import type { LeaderboardEntry } from "./types";

// Pillars beyond this are summarized ("+N more tied") instead of drawn, so a
// tie across many teams (e.g. everyone on 0 points before the first match)
// cannot squeeze the podium into unreadable slivers.
export const MAX_PODIUM_PILLARS = 9;

export interface PodiumSlot {
  entry: LeaderboardEntry;
  rank: number;
}

export interface PodiumLayout {
  // Display order: every 2nd place, then every 1st, then every 3rd. With no
  // 3rd place, the 2nd places are split to both sides of the 1st.
  slots: PodiumSlot[];
  // Teams on podium ranks that did not fit under MAX_PODIUM_PILLARS.
  hiddenCount: number;
  tiedForFirst: number;
}

/**
 * Everyone whose rank is 1, 2 or 3 stands on the podium, so ties widen a place
 * instead of dropping teams: ranks [1,2,3,3] give two 3rd-place pillars.
 * Ranks are competition ranks from the leaderboard view ([1,1,3] has no 2nd).
 * Input order inside a place is kept (the view sorts ties by name).
 */
export function buildPodium(entries: LeaderboardEntry[]): PodiumLayout {
  const byRank = (r: number) => entries.filter((e) => e.rank === r).map((entry) => ({ entry, rank: r }));
  const first = byRank(1);
  const second = byRank(2);
  const third = byRank(3);

  // Trim from the lowest place first, so 1st place is always complete if it fits.
  const kept: PodiumSlot[][] = [];
  let budget = MAX_PODIUM_PILLARS;
  for (const group of [first, second, third]) {
    kept.push(group.slice(0, Math.max(budget, 0)));
    budget -= group.length;
  }
  const [keptFirst, keptSecond, keptThird] = kept;
  const total = first.length + second.length + third.length;

  // Nothing on the right of 1st when there is no 3rd place (e.g. ranks
  // [1,2,2,4]): split the 2nd places around the winner so the podium stays
  // balanced instead of leaning left.
  const [left, right] =
    keptThird.length === 0 && keptSecond.length > 1
      ? [keptSecond.slice(0, Math.ceil(keptSecond.length / 2)), keptSecond.slice(Math.ceil(keptSecond.length / 2))]
      : [keptSecond, keptThird];

  return {
    slots: [...left, ...keptFirst, ...right],
    hiddenCount: total - (keptFirst.length + keptSecond.length + keptThird.length),
    tiedForFirst: first.length,
  };
}
