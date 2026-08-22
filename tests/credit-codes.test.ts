import { describe, it, expect } from "vitest";
import { assignCodes } from "@/lib/credit-codes";

describe("assignCodes", () => {
  it("draws codes from the bottom of the pool upward", () => {
    const res = assignCodes(["a@x.com", "b@x.com"], ["C1", "C2", "C3", "C4"]);
    expect(res.assignments).toEqual([
      { email: "a@x.com", code: "C4" },
      { email: "b@x.com", code: "C3" },
    ]);
  });

  it("leaves the unused top block as leftovers in file order", () => {
    const res = assignCodes(["a@x.com", "b@x.com"], ["C1", "C2", "C3", "C4"]);
    expect(res.leftoverCodes).toEqual(["C1", "C2"]);
  });

  it("gives every recipient a distinct code", () => {
    const emails = Array.from({ length: 50 }, (_, i) => `p${i}@x.com`);
    const codes = Array.from({ length: 60 }, (_, i) => `C${i}`);
    const res = assignCodes(emails, codes);
    expect(res.assignments).toHaveLength(50);
    expect(new Set(res.assignments.map((a) => a.code)).size).toBe(50);
    expect(res.leftoverCodes).toHaveLength(10);
    // No code is both assigned and reported as leftover.
    const assigned = new Set(res.assignments.map((a) => a.code));
    expect(res.leftoverCodes.some((c) => assigned.has(c))).toBe(false);
  });

  it("normalizes and de-duplicates recipients so nobody gets two codes", () => {
    const res = assignCodes([" A@X.com ", "a@x.com", "b@x.com"], ["C1", "C2", "C3"]);
    expect(res.assignments).toEqual([
      { email: "a@x.com", code: "C3" },
      { email: "b@x.com", code: "C2" },
    ]);
    expect(res.duplicateEmails).toEqual(["a@x.com"]);
    expect(res.leftoverCodes).toEqual(["C1"]);
  });

  it("reports recipients left unserved when the pool runs out", () => {
    const res = assignCodes(["a@x.com", "b@x.com", "c@x.com"], ["C1", "C2"]);
    expect(res.assignments).toEqual([
      { email: "a@x.com", code: "C2" },
      { email: "b@x.com", code: "C1" },
    ]);
    expect(res.unservedEmails).toEqual(["c@x.com"]);
    expect(res.leftoverCodes).toEqual([]);
  });

  it("ignores blank lines in both inputs", () => {
    const res = assignCodes(["a@x.com", "", "   "], ["C1", "", "  ", "C2"]);
    expect(res.assignments).toEqual([{ email: "a@x.com", code: "C2" }]);
    expect(res.leftoverCodes).toEqual(["C1"]);
  });

  it("handles an empty pool without assigning anything", () => {
    const res = assignCodes(["a@x.com"], []);
    expect(res.assignments).toEqual([]);
    expect(res.unservedEmails).toEqual(["a@x.com"]);
  });
});
