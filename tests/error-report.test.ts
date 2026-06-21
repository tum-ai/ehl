import { describe, it, expect } from "vitest";
import { describeError, isLikelyStaleBundleError } from "@/lib/error-report";

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
