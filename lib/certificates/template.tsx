import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

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
  isPlaced: boolean;
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
    isPlaced,
  } = props;

  const certificateTitle = isPlaced ? "Achievement" : "Participation";

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

        {/* Team info */}
        <Text style={styles.awardedTo}>Awarded to</Text>
        <Text style={styles.teamName}>{teamName}</Text>
        {university && <Text style={styles.university}>{university}</Text>}
        {memberNames.length > 0 && (
          <Text style={styles.members}>{memberNames.join("  ·  ")}</Text>
        )}

        {/* Placement badge */}
        {isPlaced ? (
          <View style={styles.placementBadge}>
            <Text style={styles.placementText}>{placementLabel}</Text>
            <Text style={styles.pointsText}>{points} points</Text>
          </View>
        ) : (
          <View style={styles.participationBadge}>
            <Text style={styles.participationText}>Participant · {points} points</Text>
          </View>
        )}

        {/* Event details */}
        <View style={styles.detailsRow}>
          <View style={styles.detailBlock}>
            <Text style={styles.detailLabel}>Match</Text>
            <Text style={styles.detailValue}>{chapterName}</Text>
          </View>
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

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            European Hackathon League · Season 1 · ehl.gg
          </Text>
        </View>
      </Page>
    </Document>
  );
}
