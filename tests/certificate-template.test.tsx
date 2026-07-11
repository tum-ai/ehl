import { describe, it, expect } from "vitest";
import type React from "react";
import { CertificateDocument, CertificateDesignGuide } from "@/lib/certificates/template";
import { TEXT_BLOCKS } from "@/lib/certificates/layout";

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

  it("custom background mode keeps all certificate text", () => {
    const text = textOf(
      CertificateDocument({
        ...baseProps,
        variant: "achievement",
        backgroundImageSrc: "data:image/png;base64,AAAA",
      })
    );
    expect(text).toContain("Quantum Ducks");
    expect(text).toContain("1st Place");
    expect(text).toContain("Munich Match");
    expect(text).toContain("European Hackathon League");
  });
});

describe("CertificateDesignGuide", () => {
  it("labels every layout text block so sponsors know the reserved areas", () => {
    const text = textOf(CertificateDesignGuide());
    for (const block of Object.values(TEXT_BLOCKS)) {
      expect(text).toContain(block.label);
    }
  });
});
