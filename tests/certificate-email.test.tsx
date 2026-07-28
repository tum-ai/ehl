import { render } from "@react-email/render";
import React from "react";
import { describe, expect, it } from "vitest";
import { CertificateEmail } from "@/lib/emails/certificate";

const baseProps = {
  memberName: "Mischa",
  teamName: "new team",
  chapterName: "Final Test",
  chapterCity: "Paris, France",
  chapterDate: "June 27, 2026 - June 28, 2026",
  resultLabel: "1st Place (+8 pts)",
  personalCertificateUrl: "https://ehl.test/achievement",
  participationCertificateUrl: "https://ehl.test/participation",
};

describe("CertificateEmail", () => {
  it("offers only the recipient's personal achievement and participation certificates", async () => {
    const html = await render(<CertificateEmail {...baseProps} />);

    expect(html).toContain("Download Your Personal Certificate (PDF)");
    expect(html).toContain("Download Participation Certificate (PDF)");
    expect(html).toContain("https://ehl.test/achievement");
    expect(html).toContain("https://ehl.test/participation");
    expect(html).not.toContain("Team Certificate");
  });

  it("sends unplaced members one personal participation link without an extra button", async () => {
    const html = await render(
      <CertificateEmail
        {...baseProps}
        resultLabel="Participant"
        personalCertificateUrl="https://ehl.test/personal-participation"
        participationCertificateUrl={null}
      />
    );

    expect(html).toContain("Download Your Personal Certificate (PDF)");
    expect(html).toContain("https://ehl.test/personal-participation");
    expect(html).not.toContain("Download Participation Certificate (PDF)");
    expect(html).not.toContain("Team Certificate");
  });
});
