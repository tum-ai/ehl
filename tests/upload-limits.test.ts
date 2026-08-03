import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CV_MAX_BYTES,
  CV_MAX_LABEL,
  CV_TOO_LARGE_MESSAGE,
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
    // another, which is the original bug in miniature.
    const mb = CV_MAX_BYTES / (1024 * 1024);
    expect(CV_MAX_LABEL).toBe(`${mb}MB`);
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
    expect(src).not.toMatch(/10 \* 1024 \* 1024/);
  });

  it("the CV field label reads the shared label", () => {
    const src = read("components/application/application-fields.tsx");
    expect(src).toContain("CV_MAX_LABEL");
    expect(src).not.toMatch(/max 10MB/);
  });
});
