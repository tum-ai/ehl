import { describe, it, expect } from "vitest";
import { repoFieldKeys, csvCell } from "../scripts/export-team-repos";
import type { SubmissionFieldConfig } from "../lib/types";

function field(partial: Partial<SubmissionFieldConfig>): SubmissionFieldConfig {
  return { key: "k", label: "L", type: "text", required: false, ...partial };
}

describe("repoFieldKeys", () => {
  it("picks fields explicitly typed as repo", () => {
    const keys = repoFieldKeys([
      field({ key: "deck", label: "Pitch Deck", type: "file" }),
      field({ key: "repo", label: "GitHub Repository", type: "repo" }),
      field({ key: "demo", label: "Live Demo", type: "url" }),
    ]);
    expect(keys).toEqual(["repo"]);
  });

  it("falls back to url fields named like a repo (the default challenge config)", () => {
    // Migration 00003 ships repo as type "url"; filtering on type alone drops it.
    const keys = repoFieldKeys([
      field({ key: "deck", label: "Pitch Deck", type: "file" }),
      field({ key: "repo", label: "GitHub Repository", type: "url" }),
      field({ key: "demo", label: "Live Demo", type: "url" }),
    ]);
    expect(keys).toEqual(["repo"]);
  });

  it("does not treat unrelated url fields as repos", () => {
    const keys = repoFieldKeys([
      field({ key: "demo", label: "Live Demo", type: "url" }),
      field({ key: "video", label: "Demo Video", type: "url" }),
    ]);
    expect(keys).toEqual([]);
  });

  it("prefers explicit repo fields over name-matched url fields", () => {
    const keys = repoFieldKeys([
      field({ key: "source", label: "Source Code", type: "repo" }),
      field({ key: "repo_mirror", label: "GitHub Mirror", type: "url" }),
    ]);
    expect(keys).toEqual(["source"]);
  });

  it("returns every explicit repo field when a challenge has several", () => {
    const keys = repoFieldKeys([
      field({ key: "frontend", label: "Frontend Repo", type: "repo" }),
      field({ key: "backend", label: "Backend Repo", type: "repo" }),
    ]);
    expect(keys).toEqual(["frontend", "backend"]);
  });

  it("handles an empty field config", () => {
    expect(repoFieldKeys([])).toEqual([]);
  });
});

describe("csvCell", () => {
  it("quotes every value", () => {
    expect(csvCell("Team Alpha")).toBe('"Team Alpha"');
  });

  it("keeps commas inside one cell", () => {
    expect(csvCell("Alpha, Beta")).toBe('"Alpha, Beta"');
  });

  it("doubles embedded quotes so the cell stays parseable", () => {
    expect(csvCell('The "Best" Team')).toBe('"The ""Best"" Team"');
  });

  it("keeps newlines inside the quoted cell", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("handles an empty value", () => {
    expect(csvCell("")).toBe('""');
  });
});
