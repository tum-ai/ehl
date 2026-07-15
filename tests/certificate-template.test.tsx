import { describe, it, expect } from "vitest";
import type React from "react";
import { CertificateDocument, CertificateDesignGuide } from "@/lib/certificates/template";
import { OVERLAY_LAYOUTS } from "@/lib/certificates/layout";

// Content tests on the React element tree (no PDF rendering needed): the
// certificate guarantees are about WHICH text appears, per variant.

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const element = node as React.ReactElement<{ children?: unknown }>;
  if (element.props) collectText(element.props.children, out);
  return out;
}

/** Flattened, whitespace-normalized text content of an element tree. */
function textOf(node: unknown): string {
  return collectText(node).join(" ").replace(/\s+/g, " ");
}

const baseProps = {
  teamName: "Quantum Ducks",
  university: "TU Munich",
  memberNames: ["Alice Adams", "Bob Brown"],
  chapterName: "Munich Match",
  chapterCity: "Munich, Germany",
  chapterDate: "March 1, 2026",
  challengeName: "AI Challenge",
  placementLabel: "1st Place",
  points: 8,
};

describe("CertificateDocument variants", () => {
  it("achievement variant shows placement and points", () => {
    const text = textOf(CertificateDocument({ ...baseProps, variant: "achievement" }));
    expect(text).toContain("Achievement");
    expect(text).toContain("1st Place");
    expect(text).toContain("8 points");
    expect(text).toContain("Quantum Ducks");
  });

  it("participation variant NEVER shows points or placement, even for a placed team", () => {
    const text = textOf(
      CertificateDocument({ ...baseProps, variant: "participation" })
    );
    expect(text).toContain("Participation");
    expect(text).toContain("Participant");
    expect(text).not.toContain("points");
    expect(text).not.toContain("1st Place");
  });

  it("team certificate lists the members and is awarded to the team", () => {
    const text = textOf(CertificateDocument({ ...baseProps, variant: "achievement" }));
    expect(text).toContain("Quantum Ducks");
    expect(text).toContain("Alice Adams");
    expect(text).toContain("Bob Brown");
  });

  it("personal certificate is awarded to the person, keeps the team in the details, and omits the member list", () => {
    const text = textOf(
      CertificateDocument({
        ...baseProps,
        memberNames: [],
        variant: "achievement",
        personName: "Alice Adams",
      })
    );
    expect(text).toContain("Alice Adams");
    expect(text).toContain("Team");
    expect(text).toContain("Quantum Ducks");
    expect(text).not.toContain("Bob Brown");
  });

  it("personal participation certificate carries the name but no points", () => {
    const text = textOf(
      CertificateDocument({
        ...baseProps,
        memberNames: [],
        variant: "participation",
        personName: "Alice Adams",
      })
    );
    expect(text).toContain("Alice Adams");
    expect(text).not.toContain("points");
  });

  it("custom design mode writes ONLY the values (the design carries all static text)", () => {
    const text = textOf(
      CertificateDocument({
        ...baseProps,
        variant: "achievement",
        backgroundImageSrc: "data:image/png;base64,AAAA",
      })
    );
    // Values on the design's underlines:
    expect(text).toContain("Munich Match");
    expect(text).toContain("Quantum Ducks");
    expect(text).toContain("1st Place");
    expect(text).toContain("8 points");
    expect(text).toContain("Munich, Germany · March 1, 2026");
    // Static text lives in the uploaded design and must NOT be re-rendered:
    expect(text).not.toContain("European Hackathon League");
    expect(text).not.toContain("Certificate of");
    expect(text).not.toContain("Awarded to");
    // The default design's member list has no field on custom designs:
    expect(text).not.toContain("Alice Adams");
  });

  it("custom design participation mode never writes rank or points", () => {
    const text = textOf(
      CertificateDocument({
        ...baseProps,
        variant: "participation",
        backgroundImageSrc: "data:image/png;base64,AAAA",
      })
    );
    expect(text).toContain("Quantum Ducks");
    expect(text).not.toContain("points");
    expect(text).not.toContain("1st Place");
  });

  it("custom design personal certificate puts the person on the awardee line and the team on the team line", () => {
    const text = textOf(
      CertificateDocument({
        ...baseProps,
        memberNames: [],
        variant: "achievement",
        personName: "Alice Adams",
        backgroundImageSrc: "data:image/png;base64,AAAA",
      })
    );
    expect(text).toContain("Alice Adams");
    expect(text).toContain("Quantum Ducks");
  });

  it("custom design team certificate leaves the team line empty (awardee IS the team)", () => {
    const collected = collectText(
      CertificateDocument({
        ...baseProps,
        variant: "achievement",
        backgroundImageSrc: "data:image/png;base64,AAAA",
      })
    );
    // The team name appears exactly once: on the awardee line.
    expect(collected.filter((t) => t.includes("Quantum Ducks"))).toHaveLength(1);
  });
});

describe("CertificateDesignGuide", () => {
  it("labels every overlay field of both variants so designers know where values land", () => {
    const text = textOf(CertificateDesignGuide());
    for (const layout of Object.values(OVERLAY_LAYOUTS)) {
      for (const field of Object.values(layout)) {
        expect(text).toContain(field.label);
      }
    }
    expect(text).toContain("Achievement certificate");
    expect(text).toContain("Participation certificate");
  });
});

describe("custom design real rendering", () => {
  // Regression: a full-page background image used to push the absolutely
  // positioned values onto a second, background-less page. Render through the
  // real react-pdf pipeline (not mocked here) and assert the single page.
  it("renders a custom-design certificate as exactly ONE page", async () => {
    const ReactPDF = (await import("@react-pdf/renderer")).default;
    // Minimal valid 1x1 PNG so react-pdf actually decodes an image.
    const PNG_1PX =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const stream = await ReactPDF.renderToStream(
      CertificateDocument({
        ...baseProps,
        variant: "achievement",
        backgroundImageSrc: PNG_1PX,
      })
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    const pdf = Buffer.concat(chunks).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("/Count 1");
    expect(pdf).not.toContain("/Count 2");
  }, 30000);
});
