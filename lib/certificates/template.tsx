import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import {
  OVERLAY_LAYOUTS,
  overlayBoxTop,
  overlayBoxHeight,
  PAGE_HEIGHT,
  type OverlayFieldSpec,
} from "./layout";
import type { CertificateVariant } from "@/lib/certificate-token";

const gold = "#E8B84B";
const purple = "#9B59B6";
const dark = "#0B0B1A";

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 60,
    fontFamily: "Helvetica",
    position: "relative",
  },
  // Full-bleed custom background (custom design mode)
  background: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  // Corner brackets
  cornerTL: {
    position: "absolute",
    top: 30,
    left: 30,
    width: 40,
    height: 40,
    borderTop: `3px solid ${purple}`,
    borderLeft: `3px solid ${purple}`,
  },
  cornerTR: {
    position: "absolute",
    top: 30,
    right: 30,
    width: 40,
    height: 40,
    borderTop: `3px solid ${purple}`,
    borderRight: `3px solid ${purple}`,
  },
  cornerBL: {
    position: "absolute",
    bottom: 30,
    left: 30,
    width: 40,
    height: 40,
    borderBottom: `3px solid ${purple}`,
    borderLeft: `3px solid ${purple}`,
  },
  cornerBR: {
    position: "absolute",
    bottom: 30,
    right: 30,
    width: 40,
    height: 40,
    borderBottom: `3px solid ${purple}`,
    borderRight: `3px solid ${purple}`,
  },
  // Header
  header: {
    textAlign: "center",
    marginBottom: 12,
  },
  ehlTitle: {
    fontSize: 14,
    letterSpacing: 6,
    color: purple,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  dividerLine: {
    width: 60,
    height: 2,
    backgroundColor: gold,
    marginVertical: 16,
    alignSelf: "center",
  },
  // Main content
  certificateOf: {
    fontSize: 12,
    letterSpacing: 4,
    color: "#888888",
    textAlign: "center",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  certificateType: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: dark,
    textAlign: "center",
    marginBottom: 24,
  },
  awardedTo: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#888888",
    textAlign: "center",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  teamName: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: dark,
    textAlign: "center",
    marginBottom: 6,
  },
  university: {
    fontSize: 13,
    color: "#666666",
    textAlign: "center",
    marginBottom: 20,
  },
  members: {
    fontSize: 11,
    color: "#555555",
    textAlign: "center",
    marginBottom: 28,
    lineHeight: 1.6,
  },
  // Details section
  detailsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 40,
    marginBottom: 24,
  },
  detailBlock: {
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 9,
    letterSpacing: 2,
    color: "#999999",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: dark,
  },
  // Placement highlight
  placementBadge: {
    backgroundColor: gold,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
    alignSelf: "center",
    marginBottom: 24,
  },
  placementText: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  pointsText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
    marginTop: 2,
  },
  participationBadge: {
    borderWidth: 2,
    borderColor: purple,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 24,
    alignSelf: "center",
    marginBottom: 24,
  },
  participationText: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: purple,
    textAlign: "center",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 50,
    left: 60,
    right: 60,
    textAlign: "center",
  },
  footerText: {
    fontSize: 9,
    color: "#AAAAAA",
    textAlign: "center",
  },
});

interface CertificateProps {
  teamName: string;
  university: string | null;
  memberNames: string[];
  chapterName: string;
  chapterCity: string;
  chapterDate: string;
  challengeName: string | null;
  placementLabel: string;
  points: number;
  /**
   * Which certificate to render. "achievement" shows the gold placement badge
   * with points; "participation" shows a neutral purple badge and NEVER any
   * points or placement, even for placed teams (operators hand these out as
   * ranking-free certificates).
   */
  variant: CertificateVariant;
  /**
   * Set for a personal certificate: the certificate is awarded to this person
   * by name, the member list is omitted and the team moves into the details
   * row for context.
   */
  personName?: string | null;
  /**
   * Optional custom background design (PNG/JPEG data URI). When set, the image
   * is drawn full-bleed and ONLY the certificate VALUES are placed onto the
   * design's field underlines (positions from lib/certificates/layout.ts). The
   * design itself carries every static element: title, "AWARDED TO", field
   * lines, logos, signature. None of the default EHL layout is rendered.
   */
  backgroundImageSrc?: string | null;
}

/** Ink for values written onto a custom design (near-black, reads as filled-in
 * rather than as part of the artwork). */
const overlayInk = "#1F1F2E";

/**
 * Font size that fits `value` on a single line of the field: the base size
 * shrinks proportionally for long values (floor: 55% of base, so extreme
 * inputs stay legible and the maxLines=1 ellipsis catches the pathological
 * rest). Width estimate: average Helvetica glyph is ~0.52em wide.
 */
export function fitOverlayFontSize(value: string, field: OverlayFieldSpec): number {
  const width = field.right - field.left;
  const estimated = value.length * 0.52 * field.fontSize;
  if (estimated <= width) return field.fontSize;
  return Math.max(field.fontSize * (width / estimated), field.fontSize * 0.55);
}

/** Centers a value on one of the design's field underlines, baseline just
 * above the line, shrinking the font for long values so nothing wraps onto
 * the design's artwork (custom design mode). */
function OverlayValue({ field, value }: { field: OverlayFieldSpec; value: string }) {
  const fontSize = fitOverlayFontSize(value, field);
  return (
    <View
      style={{
        position: "absolute",
        // Box geometry from layout.ts so the design guide draws the exact
        // same boxes (text bottom sits OVERLAY_BASELINE_GAP above the line).
        top: overlayBoxTop(field, fontSize),
        left: field.left,
        width: field.right - field.left,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontSize,
          color: overlayInk,
          textAlign: "center",
          maxLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function CertificateDocument(props: CertificateProps) {
  const {
    teamName,
    university,
    memberNames,
    chapterName,
    chapterCity,
    chapterDate,
    challengeName,
    placementLabel,
    points,
    variant,
    personName,
    backgroundImageSrc,
  } = props;

  const certificateTitle = variant === "achievement" ? "Achievement" : "Participation";
  const awardeeName = personName || teamName;

  const badge =
    variant === "achievement" ? (
      <View style={styles.placementBadge}>
        <Text style={styles.placementText}>{placementLabel}</Text>
        <Text style={styles.pointsText}>{points} points</Text>
      </View>
    ) : (
      <View style={styles.participationBadge}>
        <Text style={styles.participationText}>Participant</Text>
      </View>
    );

  const details = (
    <View style={styles.detailsRow}>
      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Match</Text>
        <Text style={styles.detailValue}>{chapterName}</Text>
      </View>
      {personName && (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Team</Text>
          <Text style={styles.detailValue}>{teamName}</Text>
        </View>
      )}
      {challengeName && (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Challenge</Text>
          <Text style={styles.detailValue}>{challengeName}</Text>
        </View>
      )}
      <View style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Location</Text>
        <Text style={styles.detailValue}>{chapterCity}</Text>
      </View>
      {chapterDate && (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Date</Text>
          <Text style={styles.detailValue}>{chapterDate}</Text>
        </View>
      )}
    </View>
  );

  const footerText = (
    <Text style={styles.footerText}>
      European Hackathon League · Season 1 · ehl.gg
    </Text>
  );

  if (backgroundImageSrc) {
    // Custom design mode: the uploaded background IS the certificate (title,
    // "AWARDED TO", field underlines, logos, signature all live in the
    // artwork). Only the VALUES are written onto the design's underlines, at
    // the per-variant positions measured from the operator's template
    // (lib/certificates/layout.ts). Nothing from the default EHL layout —
    // no badge, no member list, no footer — may be drawn here, or it would
    // collide with the design's own static text.
    const layout = OVERLAY_LAYOUTS[variant];
    return (
      <Document>
        <Page size="A4" orientation="landscape" style={{ fontFamily: "Helvetica" }}>
          {/* Single non-wrapping full-page container: without it react-pdf
              pushes the absolutely-positioned values onto a second page (and
              wrap=false directly on the Page collapses its height to zero).
              Height in points, not "100%": react-pdf's A4 is fractionally
              taller (595.28pt) and a 100% container triggers a can't-wrap
              warning on every render. A certificate is always one page. */}
          <View wrap={false} style={{ position: "relative", width: "100%", height: PAGE_HEIGHT }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            <Image src={backgroundImageSrc} style={styles.background} />

            <OverlayValue field={layout.hackathonName} value={chapterName} />
            <OverlayValue field={layout.awardee} value={awardeeName} />
            {/* The team line is context on PERSONAL certificates; on a team
                certificate the awardee already is the team, so it stays empty. */}
            {personName && <OverlayValue field={layout.teamName} value={teamName} />}
            {layout.rank && (
              <OverlayValue field={layout.rank} value={placementLabel} />
            )}
            {layout.points && (
              <OverlayValue field={layout.points} value={`${points} points`} />
            )}
            <OverlayValue
              field={layout.cityDate}
              value={chapterDate ? `${chapterCity} · ${chapterDate}` : chapterCity}
            />
          </View>
        </Page>
      </Document>
    );
  }

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Corner brackets */}
        <View style={styles.cornerTL} />
        <View style={styles.cornerTR} />
        <View style={styles.cornerBL} />
        <View style={styles.cornerBR} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.ehlTitle}>European Hackathon League</Text>
        </View>

        <View style={styles.dividerLine} />

        {/* Certificate type */}
        <Text style={styles.certificateOf}>Certificate of</Text>
        <Text style={styles.certificateType}>{certificateTitle}</Text>

        {/* Awardee (team, or one person on a personal certificate) */}
        <Text style={styles.awardedTo}>Awarded to</Text>
        <Text style={styles.teamName}>{awardeeName}</Text>
        {university && <Text style={styles.university}>{university}</Text>}
        {!personName && memberNames.length > 0 && (
          <Text style={styles.members}>{memberNames.join("  ·  ")}</Text>
        )}

        {/* Placement badge */}
        {badge}

        {/* Event details */}
        {details}

        {/* Footer */}
        <View style={styles.footer}>{footerText}</View>
      </Page>
    </Document>
  );
}

/**
 * Operator design template: a PDF marking every value field from layout.ts as
 * a labeled box, one page per certificate variant. A custom design must be a
 * COMPLETE certificate (title, "AWARDED TO", underlines, logos); the platform
 * only writes the values into these boxes. Downloaded from the admin
 * certificate-designs page.
 */
export function CertificateDesignGuide() {
  const pages: { title: string; variant: CertificateVariant }[] = [
    { title: "Achievement certificate (placed teams)", variant: "achievement" },
    { title: "Participation certificate", variant: "participation" },
  ];
  return (
    <Document>
      {pages.map(({ title, variant }) => {
        const layout = OVERLAY_LAYOUTS[variant];
        const fields = Object.values(layout) as OverlayFieldSpec[];
        return (
          <Page
            key={variant}
            size="A4"
            orientation="landscape"
            style={{ fontFamily: "Helvetica" }}
          >
            {/* Same single-container trick as the certificate itself. */}
            <View wrap={false} style={{ position: "relative", width: "100%", height: PAGE_HEIGHT }}>
              <View style={{ position: "absolute", top: 10, left: 60, right: 60 }}>
                <Text style={{ fontSize: 11, color: "#333333", textAlign: "center" }}>
                  EHL design template: {title}
                </Text>
                <Text style={{ fontSize: 8, color: "#666666", textAlign: "center", marginTop: 4 }}>
                  Your design must be a complete certificate (title, labels, underlines,
                  logos). The platform only writes the values into the boxed areas below,
                  centered, with the text baseline sitting on the box bottom. Export as
                  PNG or JPEG, A4 landscape, recommended 2384x1684 px.
                </Text>
              </View>
              {fields.map((field) => (
                <View
                  key={field.label}
                  style={{
                    position: "absolute",
                    top: overlayBoxTop(field),
                    left: field.left,
                    width: field.right - field.left,
                    height: overlayBoxHeight(field),
                    borderWidth: 1,
                    borderColor: purple,
                    borderStyle: "dashed",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 8, color: purple, textAlign: "center" }}>
                    {field.label}
                  </Text>
                </View>
              ))}
            </View>
          </Page>
        );
      })}
    </Document>
  );
}
