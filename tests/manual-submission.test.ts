import { describe, it, expect } from "vitest";
import { parseArgs, mimeForPath, validateFields } from "../scripts/manual-submission";
import type { SubmissionFieldConfig } from "../lib/types";

const CONFIG: SubmissionFieldConfig[] = [
  { key: "repo_url", label: "Repository", type: "repo", required: true },
  { key: "pitch_deck", label: "Pitch deck", type: "file", required: true },
  { key: "demo_url", label: "Demo", type: "url", required: false },
];

describe("parseArgs", () => {
  it("parses flags, bools and repeatable field/file pairs", () => {
    const args = parseArgs([
      "--chapter", "munich",
      "--team", "Team Name",
      "--field", "repo_url=https://github.com/o/r",
      "--field", "demo_url=https://demo.example",
      "--file", "pitch_deck=./deck.pdf",
      "--snapshot",
      "--dry",
    ]);

    expect(args.flags).toEqual({ chapter: "munich", team: "Team Name" });
    expect(args.bools).toEqual(new Set(["snapshot", "dry"]));
    expect(args.fields).toEqual({
      repo_url: "https://github.com/o/r",
      demo_url: "https://demo.example",
    });
    expect(args.files).toEqual({ pitch_deck: "./deck.pdf" });
  });

  it("keeps values containing '=' intact (only the first '=' splits)", () => {
    const args = parseArgs(["--field", "demo_url=https://x.dev/?a=1&b=2"]);
    expect(args.fields.demo_url).toBe("https://x.dev/?a=1&b=2");
  });

  it("lets a repeated key be corrected by its last occurrence", () => {
    const args = parseArgs(["--field", "repo_url=wrong", "--field", "repo_url=right"]);
    expect(args.fields.repo_url).toBe("right");
  });

  it("rejects a field pair without '='", () => {
    expect(() => parseArgs(["--field", "repo_url"])).toThrow(/expects key=value/);
  });

  it("rejects a field pair with an empty key", () => {
    expect(() => parseArgs(["--field", "=value"])).toThrow(/expects key=value/);
  });

  it("rejects a value-taking flag with no value", () => {
    expect(() => parseArgs(["--chapter"])).toThrow(/Missing value for --chapter/);
  });

  it("rejects a bare positional argument", () => {
    expect(() => parseArgs(["munich"])).toThrow(/Unexpected argument: munich/);
  });
});

describe("mimeForPath", () => {
  it("maps a pitch deck PDF", () => {
    expect(mimeForPath("/tmp/Some Deck.PDF")).toBe("application/pdf");
  });

  it("maps office and image types from the upload whitelist", () => {
    expect(mimeForPath("a.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(mimeForPath("a.png")).toBe("image/png");
  });

  it("rejects types the participant upload route also refuses (SVG)", () => {
    expect(() => mimeForPath("logo.svg")).toThrow(/Unsupported file type/);
  });

  it("rejects an extensionless path instead of guessing", () => {
    expect(() => mimeForPath("deck")).toThrow(/Unsupported file type/);
  });
});

describe("validateFields", () => {
  it("accepts a complete submission", () => {
    expect(validateFields(CONFIG, ["repo_url"], ["pitch_deck"])).toEqual({
      unknownKeys: [],
      missingRequired: [],
      wrongType: [],
    });
  });

  it("reports keys the challenge does not define", () => {
    const r = validateFields(CONFIG, ["repo_url", "video"], ["pitch_deck"]);
    expect(r.unknownKeys).toEqual(["video"]);
  });

  it("reports missing required fields", () => {
    const r = validateFields(CONFIG, ["demo_url"], []);
    expect(r.missingRequired).toEqual(["repo_url", "pitch_deck"]);
  });

  it("counts fields already stored on the submission as present", () => {
    const r = validateFields(CONFIG, [], ["pitch_deck"], ["repo_url"]);
    expect(r.missingRequired).toEqual([]);
  });

  it("flags a file-type field passed as --field (the artifact would be lost)", () => {
    const r = validateFields(CONFIG, ["repo_url", "pitch_deck"], []);
    expect(r.wrongType).toEqual(["pitch_deck"]);
  });

  it("flags a non-file field passed as --file", () => {
    const r = validateFields(CONFIG, [], ["pitch_deck", "repo_url"]);
    expect(r.wrongType).toEqual(["repo_url"]);
  });

  it("does not report an unknown key as a type error too", () => {
    const r = validateFields(CONFIG, [], ["pitch_deck", "nope"]);
    expect(r.unknownKeys).toEqual(["nope"]);
    expect(r.wrongType).toEqual([]);
  });
});
