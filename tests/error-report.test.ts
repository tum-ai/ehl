import { describe, it, expect } from "vitest";
import {
  describeError,
  isLikelyStaleBundleError,
  isPayloadTooLargeError,
  toReportableError,
} from "@/lib/error-report";

describe("describeError", () => {
  it("reads a real Error's name/message/stack", () => {
    const e = new TypeError("boom");
    const d = describeError(e);
    expect(d.name).toBe("TypeError");
    expect(d.message).toBe("boom");
    expect(d.stack).toContain("boom");
  });

  it("never renders 'undefined' for an empty throw", () => {
    const d = describeError(undefined);
    expect(d.name).toBe("UnknownError");
    expect(d.message).not.toBe("undefined");
    expect(d.message).toMatch(/chunk-load or navigation failure/i);
  });

  it("falls back gracefully for a non-Error object without name/message", () => {
    const d = describeError({ foo: "bar" });
    expect(d.name).toBe("UnknownError");
    expect(d.message).toBe("(empty)");
  });

  it("uses a string throw as the message", () => {
    expect(describeError("kaboom").message).toBe("kaboom");
  });
});

describe("isLikelyStaleBundleError", () => {
  it("flags an empty/undefined throw (no detail = navigation/chunk artifact)", () => {
    expect(isLikelyStaleBundleError(undefined)).toBe(true);
    expect(isLikelyStaleBundleError(null)).toBe(true);
    expect(isLikelyStaleBundleError({})).toBe(true);
  });

  it("flags explicit chunk-load errors", () => {
    expect(isLikelyStaleBundleError(new Error("Loading chunk 42 failed"))).toBe(true);
    const ce = new Error("boom");
    ce.name = "ChunkLoadError";
    expect(isLikelyStaleBundleError(ce)).toBe(true);
    expect(
      isLikelyStaleBundleError(new Error("Failed to fetch dynamically imported module"))
    ).toBe(true);
  });

  it("does NOT flag an ordinary error or a server-thrown error with a digest", () => {
    expect(isLikelyStaleBundleError(new TypeError("cannot read x"))).toBe(false);
    expect(isLikelyStaleBundleError({ message: "Server error", digest: "abc123" })).toBe(false);
  });
});

describe("isPayloadTooLargeError", () => {
  it("flags a numeric 413 status on the thrown object", () => {
    expect(isPayloadTooLargeError({ status: 413 })).toBe(true);
    expect(isPayloadTooLargeError({ statusCode: 413 })).toBe(true);
  });

  it("flags the wording used by proxies and by Next's body limit", () => {
    expect(isPayloadTooLargeError(new Error("Payload Too Large"))).toBe(true);
    expect(isPayloadTooLargeError(new Error("Request Entity Too Large"))).toBe(true);
    expect(isPayloadTooLargeError(new Error("Content Too Large"))).toBe(true);
    expect(isPayloadTooLargeError(new Error("Body exceeded 25mb limit"))).toBe(true);
    expect(isPayloadTooLargeError(new Error("Request failed with status 413"))).toBe(true);
  });

  it("does NOT flag a plain network failure", () => {
    // The whole point of the classifier: telling someone to shrink their CV
    // when their WiFi dropped sends them down the wrong path entirely.
    expect(isPayloadTooLargeError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPayloadTooLargeError(new Error("NetworkError when attempting to fetch"))).toBe(false);
    expect(isPayloadTooLargeError(new Error("The operation was aborted"))).toBe(false);
  });

  it("does NOT flag an empty or absent throw", () => {
    expect(isPayloadTooLargeError(undefined)).toBe(false);
    expect(isPayloadTooLargeError(null)).toBe(false);
    expect(isPayloadTooLargeError({})).toBe(false);
  });

  it("does not match an unrelated number that merely contains 413", () => {
    expect(isPayloadTooLargeError(new Error("failed after 4130 ms"))).toBe(false);
  });
});

describe("toReportableError", () => {
  it("preserves name, message and stack from a real Error", () => {
    const e = new TypeError("boom");
    const r = toReportableError(e);
    expect(r.name).toBe("TypeError");
    expect(r.message).toBe("boom");
    expect(r.stack).toBe(e.stack);
  });

  it("appends context so it survives into the event log", () => {
    // The /api/errors route whitelists its fields, so context that is not in
    // the message is silently dropped. Byte counts are the whole reason this
    // failure class was undiagnosable, so they must ride along.
    const r = toReportableError(new Error("Failed to fetch"), {
      form: "apply",
      cvBytes: 4823449,
    });
    expect(r.message).toBe("Failed to fetch [form=apply cvBytes=4823449]");
  });

  it("omits the context suffix entirely when there is none", () => {
    expect(toReportableError(new Error("boom")).message).toBe("boom");
    expect(toReportableError(new Error("boom"), {}).message).toBe("boom");
  });

  it("carries a server digest through when present", () => {
    const r = toReportableError({ message: "Server error", digest: "abc123" });
    expect(r.digest).toBe("abc123");
  });

  it("normalises an empty throw instead of reporting 'undefined'", () => {
    const r = toReportableError(undefined, { form: "apply", cvBytes: 0 });
    expect(r.name).toBe("UnknownError");
    expect(r.message).not.toContain("undefined");
    expect(r.message).toContain("[form=apply cvBytes=0]");
  });
});
