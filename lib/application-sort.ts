/**
 * Gender display + sort for the admin applications table.
 *
 * Gender is NOT a column on `applications`: it lives inside the `form_data`
 * JSON blob (see buildApplicationInsert in lib/applications-shared.ts), where
 * it is written as `formData.get("gender") || null`. So a row can legitimately
 * carry null, undefined or an empty string, and three separate cases produce
 * one:
 *   - the walk-in form never asks for gender at all,
 *   - rows created before the field existed,
 *   - "Prefer not to answer" is a real VALUE, not a blank, and must stay
 *     distinguishable from a missing answer.
 *
 * Kept out of the page component so the comparator is unit testable: a page.tsx
 * in the App Router should only export the route's own contract (default,
 * metadata, segment config), not arbitrary helpers.
 */

/** Shown in the table when a row carries no gender answer at all. */
export const GENDER_NOT_PROVIDED = "Not provided";

/** The values the public apply form offers, in the order it offers them. */
export const GENDER_OPTIONS = [
  "Male",
  "Female",
  "Other",
  "Prefer not to answer",
] as const;

/**
 * What to render in the Gender cell. Whitespace-only is treated as missing, so
 * a stray " " does not render as a blank cell with no explanation.
 */
export function genderLabel(gender: string | null | undefined): string {
  const trimmed = (gender ?? "").trim();
  return trimmed.length > 0 ? trimmed : GENDER_NOT_PROVIDED;
}

/**
 * Direction-agnostic comparator, matching the other columns in the table: the
 * caller multiplies the result by its sort direction (`cmp * dir`), so this
 * must never hard-code "blanks last" -- that would invert along with the arrow
 * and read as a bug. Missing values compare as the empty string and therefore
 * group together at whichever end the current direction puts them, exactly how
 * the Score column's unscored rows behave.
 */
export function compareGender(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  return (a ?? "").trim().localeCompare((b ?? "").trim());
}
