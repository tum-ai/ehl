import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CV_MAX_BYTES,
  CV_MAX_LABEL,
  CV_TOO_LARGE_MESSAGE,
  megabyteLabel,
  PLATFORM_REQUEST_BODY_LIMIT_BYTES,
  REQUEST_TOO_LARGE_MESSAGE,
} from "@/lib/config/upload-limits";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("CV upload limit", () => {
  it("stays strictly under the platform request body limit", () => {
    // The regression this guards: a CV cap at or above the platform limit is
    // unenforceable by our code. The request is rejected at the edge, the
    // server action never runs, and the user gets an opaque failure.
    expect(CV_MAX_BYTES).toBeLessThan(PLATFORM_REQUEST_BODY_LIMIT_BYTES);
  });

  it("leaves headroom for the rest of the multipart body", () => {
    // The CV is not the whole request: profile fields, up to four team members
    // and the Turnstile token ride along. A cap that only just fits the CV
    // still fails once encoded, so require a real margin rather than 1 byte.
    const headroom = PLATFORM_REQUEST_BODY_LIMIT_BYTES - CV_MAX_BYTES;
    expect(headroom).toBeGreaterThanOrEqual(256 * 1024);
  });

  it("labels the limit with the number that is actually enforced", () => {
    // CV_MAX_LABEL is shown in the field label and in both error messages. If
    // it drifts from CV_MAX_BYTES, users are told one number and held to
    // another, which is the original bug in miniature. The label is derived, so
    // this now guards against someone replacing the derivation with a literal.
    const mb = CV_MAX_BYTES / (1024 * 1024);
    expect(CV_MAX_LABEL).toBe(`${mb}MB`);
  });

  it("renders whole and fractional caps the way a user would read them", () => {
    // Exercised directly because the derivation must stay correct for a cap the
    // project might move to, not only for today's value.
    expect(megabyteLabel(4 * 1024 * 1024)).toBe("4MB");
    expect(megabyteLabel(10 * 1024 * 1024)).toBe("10MB");
    expect(megabyteLabel(4.5 * 1024 * 1024)).toBe("4.5MB");
    expect(megabyteLabel(Math.floor(4.5 * 1024 * 1024))).toBe("4.5MB");
    expect(megabyteLabel(512 * 1024)).toBe("0.5MB");
  });

  it("names the limit in every message that mentions size", () => {
    expect(CV_TOO_LARGE_MESSAGE).toContain(CV_MAX_LABEL);
    expect(REQUEST_TOO_LARGE_MESSAGE).toContain(CV_MAX_LABEL);
  });

  it("uses distinct text for the two failure modes", () => {
    // One is caught before sending, the other after a rejected request. They
    // must not collapse back into a single indistinguishable string.
    expect(CV_TOO_LARGE_MESSAGE).not.toBe(REQUEST_TOO_LARGE_MESSAGE);
  });

  it("has no em dashes in user-visible text (house style)", () => {
    expect(CV_TOO_LARGE_MESSAGE).not.toContain("—");
    expect(REQUEST_TOO_LARGE_MESSAGE).not.toContain("—");
  });
});

describe("no hardcoded CV size limits survive", () => {
  // Before this change the cap existed as a literal in four places and the UI
  // copy in a fifth, and they disagreed with reality and with docs/SECURITY.md.
  // Every consumer must now read the shared constant.
  const consumers = [
    "components/application/application-form.tsx",
    "components/application/walk-in-form.tsx",
    "lib/actions/applications.ts",
    "lib/actions/walk-in.ts",
  ];

  it.each(consumers)("%s enforces the shared constant, not a literal", (file) => {
    const src = read(file);
    expect(src).toContain("CV_MAX_BYTES");
    // Ban ANY megabyte arithmetic, not just the legacy `10 * 1024 * 1024`.
    // Banning only the old value would let the next hardcoded cap through,
    // which is how five copies of this number came to disagree in the first
    // place. None of these files has a legitimate reason to compute a byte
    // size inline.
    expect(src).not.toMatch(/\d+\s*\*\s*1024\s*\*\s*1024/);
  });

  it.each(consumers)("%s does not restate the limit in prose", (file) => {
    // A hardcoded "max 10MB" in a string drifts from the enforced bytes just as
    // easily as a numeric literal does, and it is what users actually read.
    expect(read(file)).not.toMatch(/\d+(\.\d+)?\s?MB/);
  });

  it("the CV field label reads the shared label", () => {
    const src = read("components/application/application-fields.tsx");
    expect(src).toContain("CV_MAX_LABEL");
    expect(src).not.toMatch(/max 10MB/);
  });
});
