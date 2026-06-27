import { describe, it, expect } from "vitest";
import {
  shouldShowFinalizedBlock,
  hasJury,
  type ChallengeProgressLike,
} from "@/lib/jury-view";

// REGRESSION: the admin Jury page mapped over challenges and read cp.finalized /
// cp.jurors. A challenge with NO progress entry has cp === undefined, and an
// unguarded cp.finalized crashed the WHOLE /admin/jury page ("Cannot read
// properties of undefined (reading 'finalized')") — which presented as "I get
// redirected and can't add a jury member". These helpers must be null-safe.
describe("jury-view render guards are null-safe", () => {
  const finalized: ChallengeProgressLike = { finalized: true, jurors: [] };
  const open: ChallengeProgressLike = {
    finalized: false,
    jurors: [{ status: "voted" }],
  };

  it("shouldShowFinalizedBlock returns false for a missing progress entry (no crash)", () => {
    expect(shouldShowFinalizedBlock(undefined)).toBe(false);
    expect(shouldShowFinalizedBlock(null)).toBe(false);
  });

  it("shouldShowFinalizedBlock reflects finalized state when present", () => {
    expect(shouldShowFinalizedBlock(finalized)).toBe(true);
    expect(shouldShowFinalizedBlock(open)).toBe(false);
  });

  it("hasJury is false for a missing entry or empty jurors, true otherwise", () => {
    expect(hasJury(undefined)).toBe(false);
    expect(hasJury(null)).toBe(false);
    expect(hasJury({ finalized: false, jurors: [] })).toBe(false);
    expect(hasJury(open)).toBe(true);
  });
});
