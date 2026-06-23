import { describe, it, expect } from "vitest";
import { withEntireGate } from "@/lib/entire-verify";

// withEntireGate decides whether the Verify step blocks on the Entire gate.
// Paris dry-run UX bug: verify passed (valid:true + a mere warning) and the hard
// gate only fired at Submit. Now a DEFINITE gate failure blocks at Verify — but a
// transient error must NOT (no false positives).
const base = { valid: true, repoName: "o/r", isPrivate: false };

describe("withEntireGate", () => {
  it("blocks (valid:false) when the gate definitively fails (entireOk === false)", () => {
    const res = withEntireGate(base, { entireOk: false, entireWarning: "no checkpoint branch" });
    expect(res.valid).toBe(false);
    expect(res.error).toBe("no checkpoint branch");
    // The success fields are dropped on a block.
    expect(res.repoName).toBeUndefined();
  });

  it("falls back to a generic error when entireOk is false but no warning is given", () => {
    const res = withEntireGate(base, { entireOk: false });
    expect(res.valid).toBe(false);
    expect(typeof res.error).toBe("string");
    expect((res.error as string).length).toBeGreaterThan(0);
  });

  it("passes through (stays valid) when the gate succeeds (entireOk === true)", () => {
    const res = withEntireGate(base, { entireOk: true });
    expect(res.valid).toBe(true);
    expect(res.repoName).toBe("o/r");
    expect(res.entireOk).toBe(true);
  });

  it("does NOT block on a transient error / not-applicable ({}) — no false positive", () => {
    // entireFeedback returns {} on a transient error OR when entire is not required.
    const res = withEntireGate(base, {});
    expect(res.valid).toBe(true);
    expect(res.repoName).toBe("o/r");
    // entireOk stays undefined; nothing is asserted about the gate.
    expect(res.entireOk).toBeUndefined();
  });

  it("merges a warning without blocking when entireOk is not explicitly false", () => {
    // Defensive: a warning present but entireOk undefined must not block.
    const res = withEntireGate(base, { entireWarning: "heads up" });
    expect(res.valid).toBe(true);
    expect(res.entireWarning).toBe("heads up");
  });
});
