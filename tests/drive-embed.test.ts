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

  it("returns null for a foreign host that mimics a Drive path or id param", () => {
    // A tampered submission field could try to smuggle an id via a non-Drive
    // host; the host check must reject these so they never reach the embed/grant.
    expect(extractDriveFileId("https://evil.example.com/?id=ABC123")).toBeNull();
    expect(extractDriveFileId("https://evil.example.com/file/d/ABC123/view")).toBeNull();
    expect(extractDriveFileId("https://drive.google.com.evil.com/?id=ABC123")).toBeNull();
  });

  it("returns null for a non-absolute / malformed URL", () => {
    expect(extractDriveFileId("/file/d/ABC123/view")).toBeNull();
    expect(extractDriveFileId("not a url")).toBeNull();
  });

  it("accepts docs.google.com as a Drive host", () => {
    expect(extractDriveFileId("https://docs.google.com/open?id=DOC123")).toBe("DOC123");
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
