import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import {
  CONTENT_INSET_X,
  TEXT_BLOCKS,
  type TextBlockSpec,
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
   * is drawn full-bleed, the EHL decorations (corner brackets, divider) are
   * suppressed, and every text block is placed at the fixed positions from
   * lib/certificates/layout.ts so sponsors can design around documented areas.
   */
  backgroundImageSrc?: string | null;
}

/** Absolutely positions children at a layout block (custom design mode). */
function FixedBlock({ block, children }: { block: TextBlockSpec; children: React.ReactNode }) {
  return (
    <View
      style={{
        position: "absolute",
        top: block.top,
        left: CONTENT_INSET_X,
        right: CONTENT_INSET_X,
        alignItems: "center",
      }}
    >
      {children}
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
    // Custom design mode: full-bleed background, text at fixed positions from
    // layout.ts. No flow layout here — positions must not depend on content
    // length, or sponsor designs would break for long member lists.
    return (
      <Document>
        <Page size="A4" orientation="landscape" style={{ position: "relative", fontFamily: "Helvetica" }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
          <Image src={backgroundImageSrc} style={styles.background} />

          <FixedBlock block={TEXT_BLOCKS.header}>
            <Text style={styles.ehlTitle}>European Hackathon League</Text>
          </FixedBlock>
          <FixedBlock block={TEXT_BLOCKS.certificateOf}>
            <Text style={styles.certificateOf}>Certificate of</Text>
          </FixedBlock>
          <FixedBlock block={TEXT_BLOCKS.title}>
            <Text style={styles.certificateType}>{certificateTitle}</Text>
          </FixedBlock>
          <FixedBlock block={TEXT_BLOCKS.awardedTo}>
            <Text style={styles.awardedTo}>Awarded to</Text>
          </FixedBlock>
          <FixedBlock block={TEXT_BLOCKS.name}>
            <Text style={styles.teamName}>{awardeeName}</Text>
          </FixedBlock>
          {university && (
            <FixedBlock block={TEXT_BLOCKS.university}>
              <Text style={styles.university}>{university}</Text>
            </FixedBlock>
          )}
          {!personName && memberNames.length > 0 && (
            <FixedBlock block={TEXT_BLOCKS.members}>
              <Text style={styles.members}>{memberNames.join("  ·  ")}</Text>
            </FixedBlock>
          )}
          <FixedBlock block={TEXT_BLOCKS.badge}>{badge}</FixedBlock>
          <FixedBlock block={TEXT_BLOCKS.details}>{details}</FixedBlock>
          <FixedBlock block={TEXT_BLOCKS.footer}>{footerText}</FixedBlock>
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
 * Operator design template: a PDF marking every text area from layout.ts as a
 * labeled box, so sponsors know which regions of their background design must
 * stay free. Downloaded from the admin certificate-designs page.
 */
export function CertificateDesignGuide() {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={{ position: "relative", fontFamily: "Helvetica" }}>
        <View
          style={{
            position: "absolute",
            top: 8,
            left: CONTENT_INSET_X,
            right: CONTENT_INSET_X,
          }}
        >
          <Text style={{ fontSize: 10, color: "#666666", textAlign: "center" }}>
            EHL certificate design template (A4 landscape). Boxed areas are used for
            certificate text: keep them free of important artwork.
          </Text>
        </View>
        {Object.values(TEXT_BLOCKS).map((block) => (
          <View
            key={block.label}
            style={{
              position: "absolute",
              top: block.top,
              left: CONTENT_INSET_X,
              right: CONTENT_INSET_X,
              height: block.height,
              borderWidth: 1,
              borderColor: purple,
              borderStyle: "dashed",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 8, color: purple, textAlign: "center" }}>
              {block.label}
            </Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
