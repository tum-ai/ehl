// Single source of truth for certificate text geometry (A4 landscape, points).
//
// CUSTOM DESIGN MODE (operator-uploaded backgrounds): the uploaded design is a
// COMPLETE certificate (title, "AWARDED TO", field underlines, logos) and the
// renderer only fills in the VALUES on the design's underlines. The field
// positions below are measured from the operator's certificate template
// ("Hackathon Certificates Templates" PDF, A4 landscape 842x595pt, one field
// map per variant). Backgrounds exported from that template line up exactly.
//
// Two consumers depend on these numbers staying in sync:
//   1. `lib/certificates/template.tsx` places every value from them.
//   2. The operator design-template PDF (`CertificateDesignGuide`) draws the
//      same fields as labeled boxes, one page per variant, so designers know
//      where values will land. If a position changes here, both the rendered
//      certificates and the guide move together — they cannot drift apart.

/** A4 landscape in PDF points. */
export const PAGE_WIDTH = 842;
export const PAGE_HEIGHT = 595;

export interface OverlayFieldSpec {
  /** Y of the field's underline in the design, from the top edge (pt). The
   * value's baseline sits just above this line. */
  lineY: number;
  /** Left edge of the underline (pt). */
  left: number;
  /** Right edge of the underline (pt). */
  right: number;
  /** Font size of the value (pt). */
  fontSize: number;
  /** Human-readable label used in the operator design guide. */
  label: string;
}

interface OverlayLayout {
  hackathonName: OverlayFieldSpec;
  awardee: OverlayFieldSpec;
  teamName: OverlayFieldSpec;
  /** Achievement only: placement, left column. */
  rank?: OverlayFieldSpec;
  /** Achievement only: points, right column. */
  points?: OverlayFieldSpec;
  cityDate: OverlayFieldSpec;
  /** Present in the design but NEVER auto-filled (a printed signature belongs
   * into the background artwork). Listed so the guide can say so. */
  signature: OverlayFieldSpec & { neverFilled: true };
}

/** Field positions measured from the operator's template, per variant. The
 * participation design has no rank/points row, so its lower fields sit
 * slightly deeper than on the achievement design. */
export const OVERLAY_LAYOUTS: Record<"achievement" | "participation", OverlayLayout> = {
  achievement: {
    hackathonName: { lineY: 243, left: 237, right: 605, fontSize: 15, label: "Hackathon name" },
    awardee: { lineY: 311, left: 180, right: 662, fontSize: 24, label: "Awarded to (participant or team name)" },
    teamName: { lineY: 371, left: 294, right: 549, fontSize: 13, label: "Team name (personal certificates)" },
    rank: { lineY: 430, left: 182, right: 397, fontSize: 14, label: "Rank / placement" },
    points: { lineY: 430, left: 445, right: 660, fontSize: 14, label: "Points / score" },
    cityDate: { lineY: 492, left: 176, right: 403, fontSize: 10, label: "City, date" },
    signature: { lineY: 492, left: 440, right: 666, fontSize: 10, label: "Signature (not auto-filled)", neverFilled: true },
  },
  participation: {
    hackathonName: { lineY: 243, left: 237, right: 605, fontSize: 15, label: "Hackathon name" },
    awardee: { lineY: 334, left: 180, right: 662, fontSize: 24, label: "Awarded to (participant or team name)" },
    teamName: { lineY: 407, left: 294, right: 549, fontSize: 13, label: "Team name (personal certificates)" },
    cityDate: { lineY: 481, left: 176, right: 403, fontSize: 10, label: "City, date" },
    signature: { lineY: 481, left: 440, right: 666, fontSize: 10, label: "Signature (not auto-filled)", neverFilled: true },
  },
};

/** Gap between a value's text bottom and its underline (pt). */
export const OVERLAY_BASELINE_GAP = 6;

/** react-pdf line-box factor for built-in Helvetica; validated visually
 * against the operator's design (values sit on the underlines). */
export const OVERLAY_LINE_HEIGHT_FACTOR = 1.2;

// Shared box geometry so the renderer and the design guide use the SAME
// numbers by construction (this file's whole purpose).
export function overlayBoxTop(field: OverlayFieldSpec, fontSize = field.fontSize): number {
  return field.lineY - OVERLAY_BASELINE_GAP - fontSize * OVERLAY_LINE_HEIGHT_FACTOR;
}
export function overlayBoxHeight(field: OverlayFieldSpec, fontSize = field.fontSize): number {
  return fontSize * OVERLAY_LINE_HEIGHT_FACTOR + OVERLAY_BASELINE_GAP;
}

/**
 * Uploaded designs must match the page's A4-landscape aspect ratio: the image
 * is stretched full-bleed, so any other aspect shifts the design's printed
 * field lines away from the fixed value positions above. sqrt(2):1 with a
 * small tolerance for rounding in exports.
 */
export const REQUIRED_BACKGROUND_ASPECT = PAGE_WIDTH / PAGE_HEIGHT;
export const BACKGROUND_ASPECT_TOLERANCE = 0.03;

export function isValidBackgroundAspect(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const aspect = width / height;
  return Math.abs(aspect - REQUIRED_BACKGROUND_ASPECT) <= REQUIRED_BACKGROUND_ASPECT * BACKGROUND_ASPECT_TOLERANCE;
}

/**
 * Recommended raster size for uploaded backgrounds: 200 dpi A4 landscape.
 * Documented in the admin UI and docs; not enforced (any PNG/JPEG under the
 * size cap renders full-bleed).
 */
export const RECOMMENDED_BACKGROUND_PX = { width: 2384, height: 1684 };
