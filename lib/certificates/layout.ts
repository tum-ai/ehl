// Single source of truth for certificate text geometry (A4 landscape, points).
//
// Two consumers depend on these numbers staying in sync:
//   1. `lib/certificates/template.tsx` positions every text block from them when
//      a custom background design is used (absolute layout, so positions are
//      deterministic regardless of how many members a team has).
//   2. The operator design-template PDF (`CertificateDesignGuide`) draws the
//      same blocks as labeled boxes so sponsors know which areas to keep free.
// If a position changes here, both the rendered certificates and the guide
// sponsors design against move together — they cannot drift apart.

/** A4 landscape in PDF points. */
export const PAGE_WIDTH = 842;
export const PAGE_HEIGHT = 595;

/** Horizontal inset of every text block; all blocks span the full width between
 * insets and are center-aligned. */
export const CONTENT_INSET_X = 60;

export interface TextBlockSpec {
  /** Distance from the top edge of the page, in points. */
  top: number;
  /** Reserved height sponsors must keep free, in points. */
  height: number;
  /** Human-readable label used in the operator design guide. */
  label: string;
}

/**
 * Fixed vertical positions of every text block drawn onto a custom background.
 * The values approximate the default (flow-layout) EHL design so a certificate
 * looks familiar whether or not a custom design is uploaded.
 */
export const TEXT_BLOCKS = {
  header: { top: 60, height: 20, label: "EUROPEAN HACKATHON LEAGUE (wordmark)" },
  certificateOf: { top: 108, height: 16, label: "CERTIFICATE OF" },
  title: { top: 128, height: 40, label: "Achievement / Participation (title)" },
  awardedTo: { top: 186, height: 14, label: "AWARDED TO" },
  name: { top: 204, height: 36, label: "Team or participant name" },
  university: { top: 244, height: 18, label: "University" },
  members: { top: 268, height: 34, label: "Member names (team certificates)" },
  badge: { top: 312, height: 52, label: "Placement / participant badge" },
  details: { top: 384, height: 44, label: "Match / challenge / location / date" },
  footer: { top: PAGE_HEIGHT - 50, height: 14, label: "EHL footer line" },
} as const satisfies Record<string, TextBlockSpec>;

/**
 * Recommended raster size for uploaded backgrounds: 200 dpi A4 landscape.
 * Documented in the admin UI and docs; not enforced (any PNG/JPEG under the
 * size cap renders full-bleed).
 */
export const RECOMMENDED_BACKGROUND_PX = { width: 2384, height: 1684 };
