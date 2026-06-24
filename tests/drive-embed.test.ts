import { describe, it, expect } from "vitest";
import { extractDriveFileId, getDriveEmbedUrl } from "@/lib/drive-embed";

describe("extractDriveFileId", () => {
  it("parses the /file/d/{id}/view format", () => {
    expect(
      extractDriveFileId("https://drive.google.com/file/d/ABC_123-xyz/view")
    ).toBe("ABC_123-xyz");
  });

  it("parses the uc?export=download&id={id} format", () => {
    expect(
      extractDriveFileId("https://drive.google.com/uc?export=download&id=ID456")
    ).toBe("ID456");
  });

  it("parses the /open?id={id} format", () => {
    expect(
      extractDriveFileId("https://drive.google.com/open?id=OPEN789")
    ).toBe("OPEN789");
  });

  it("returns null for a non-Drive URL", () => {
    expect(extractDriveFileId("https://example.com/deck.pdf")).toBeNull();
  });
});

describe("getDriveEmbedUrl", () => {
  it("builds the /preview embed URL for a Drive file URL", () => {
    expect(
      getDriveEmbedUrl("https://drive.google.com/file/d/DECK1/view")
    ).toBe("https://drive.google.com/file/d/DECK1/preview");
  });

  it("returns null when the URL is not a Drive link", () => {
    expect(getDriveEmbedUrl("https://github.com/team/repo")).toBeNull();
  });
});
