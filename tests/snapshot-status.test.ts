import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_WARNING,
  hasRepoField,
  snapshotState,
  missingSnapshots,
  snapshotStatusLabel,
} from "@/lib/snapshot-status";

describe("hasRepoField", () => {
  it("is true when any field value carries a github.com URL", () => {
    expect(hasRepoField({ repo: "https://github.com/acme/app" })).toBe(true);
  });

  it("is false for submissions with no repo field at all", () => {
    expect(hasRepoField({ deck: "https://drive.google.com/file/d/abc" })).toBe(false);
  });

  it("is false for null, undefined and empty field sets", () => {
    expect(hasRepoField(null)).toBe(false);
    expect(hasRepoField(undefined)).toBe(false);
    expect(hasRepoField({})).toBe(false);
  });

  it("ignores non-string values rather than throwing", () => {
    expect(hasRepoField({ count: 3, flag: true, nested: { a: 1 } })).toBe(false);
  });
});

describe("snapshotState", () => {
  it("is 'snapshotted' when a repo submission carries a fork URL", () => {
    expect(
      snapshotState({
        forkUrl: "https://github.com/ehl-org/zurich-team",
        fields: { repo: "https://github.com/acme/app" },
      })
    ).toBe("snapshotted");
  });

  it("is 'missing' when a repo submission has no fork URL", () => {
    expect(
      snapshotState({ forkUrl: null, fields: { repo: "https://github.com/acme/app" } })
    ).toBe("missing");
  });

  it("treats undefined forkUrl the same as null", () => {
    expect(
      snapshotState({ forkUrl: undefined, fields: { repo: "https://github.com/acme/app" } })
    ).toBe("missing");
  });

  it("is 'not_applicable' when the submission has no repo, even with no fork", () => {
    expect(snapshotState({ forkUrl: null, fields: { deck: "https://drive.google.com/x" } })).toBe(
      "not_applicable"
    );
  });
});

describe("missingSnapshots", () => {
  it("returns only the repo submissions still owed a fork", () => {
    const rows = [
      { id: "a", forkUrl: null, fields: { repo: "https://github.com/a/a" } },
      { id: "b", forkUrl: "https://github.com/ehl-org/b", fields: { repo: "https://github.com/b/b" } },
      { id: "c", forkUrl: null, fields: { deck: "https://drive.google.com/c" } },
      { id: "d", forkUrl: null, fields: { repo: "https://github.com/d/d" } },
    ];

    expect(missingSnapshots(rows).map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("is empty when everything is snapshotted", () => {
    expect(
      missingSnapshots([
        { forkUrl: "https://github.com/ehl-org/x", fields: { repo: "https://github.com/x/x" } },
      ])
    ).toEqual([]);
  });

  it("does not count a deck-only submission as missing", () => {
    expect(missingSnapshots([{ forkUrl: null, fields: { deck: "https://drive.google.com/x" } }])).toEqual(
      []
    );
  });
});

describe("snapshotStatusLabel", () => {
  it("labels every state", () => {
    expect(snapshotStatusLabel("snapshotted")).toBe("Snapshotted");
    expect(snapshotStatusLabel("missing")).toBe("Not snapshotted");
    expect(snapshotStatusLabel("not_applicable")).toBe("No repo");
  });
});

describe("SNAPSHOT_WARNING", () => {
  it("tells the team their submission IS saved", () => {
    // The whole point of the non-blocking snapshot: a GitHub failure must never
    // read as a failed submission.
    expect(SNAPSHOT_WARNING.toLowerCase()).toContain("saved");
  });

  it("contains no em dash (house style)", () => {
    expect(SNAPSHOT_WARNING).not.toContain("—");
  });
});
