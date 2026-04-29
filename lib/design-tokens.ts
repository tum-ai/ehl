/** EHL CI Design Tokens — non-negotiable brand colors and city data */

export const CI = {
  platinum: "#EFEFEF",
  lavender: "#9A64D9",
  darkAmethyst: "#1B0049",
  graphite: "#393645",
  jasmine: "#FFCE77",
  background: "#0A0020",
} as const;

export type CIColor = (typeof CI)[keyof typeof CI];

export const CITIES = [
  { name: "Munich", lat: 48.1351, lng: 11.582, color: CI.jasmine, isOrigin: true },
  { name: "Paris", lat: 48.8566, lng: 2.3522, color: CI.lavender, isOrigin: false },
  { name: "Berlin", lat: 52.52, lng: 13.405, color: CI.lavender, isOrigin: false },
  { name: "Zurich", lat: 47.3769, lng: 8.5417, color: CI.lavender, isOrigin: false },
] as const;

export type City = (typeof CITIES)[number];

/** All 6 edges of the K₄ complete graph connecting the four cities */
export function getCityPairs(): [City, City][] {
  const pairs: [City, City][] = [];
  for (let i = 0; i < CITIES.length; i++) {
    for (let j = i + 1; j < CITIES.length; j++) {
      pairs.push([CITIES[i], CITIES[j]]);
    }
  }
  return pairs;
}

/** Podium rank accent colors — single source of truth */
export const RANK_COLORS: Record<number, string> = {
  1: CI.jasmine,
  2: CI.platinum,
  3: CI.lavender,
};

/** Animation easing curves (Framer Motion cubic-bezier format) */
export const EASING = {
  enter: [0.16, 1, 0.3, 1] as [number, number, number, number],
  pop: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  fade: [0.4, 0, 0.2, 1] as [number, number, number, number],
};

/** Animation phase ordering for the hero entry sequence */
export const PHASES = [
  "atmosphere",
  "map",
  "cities",
  "network",
  "stars",
  "wordmark",
  "tagline",
  "complete",
] as const;

export type HeroPhase = (typeof PHASES)[number];

/** Returns true if `current` phase is at or past `target` phase */
export function phaseReached(current: HeroPhase, target: HeroPhase): boolean {
  return PHASES.indexOf(current) >= PHASES.indexOf(target);
}
