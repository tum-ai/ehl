import { describe, it, expect } from "vitest";
import {
  GENDER_NOT_PROVIDED,
  GENDER_OPTIONS,
  genderLabel,
  compareGender,
} from "@/lib/application-sort";

// Gender lives inside applications.form_data, not in a column, and three
// different situations yield an absent value (walk-in rows, pre-field rows,
// and a cleared answer). These pin the two behaviors the admin table relies
// on: what a cell renders, and how the column orders.

describe("genderLabel", () => {
  it("returns the stored answer unchanged for every option the form offers", () => {
    for (const option of GENDER_OPTIONS) {
      expect(genderLabel(option)).toBe(option);
    }
  });

  it("keeps 'Prefer not to answer' as a real value, not a blank", () => {
    // This is an ANSWER the applicant gave. Collapsing it into "Not provided"
    // would lose the distinction between declining and never being asked.
    expect(genderLabel("Prefer not to answer")).toBe("Prefer not to answer");
    expect(genderLabel("Prefer not to answer")).not.toBe(GENDER_NOT_PROVIDED);
  });

  it("labels null, undefined and empty string as not provided", () => {
    expect(genderLabel(null)).toBe(GENDER_NOT_PROVIDED);
    expect(genderLabel(undefined)).toBe(GENDER_NOT_PROVIDED);
    expect(genderLabel("")).toBe(GENDER_NOT_PROVIDED);
  });

  it("treats a whitespace-only value as not provided", () => {
    // Otherwise the cell renders visually empty with no explanation.
    expect(genderLabel("   ")).toBe(GENDER_NOT_PROVIDED);
  });
});

describe("compareGender", () => {
  it("orders two different answers alphabetically", () => {
    expect(compareGender("Female", "Male")).toBeLessThan(0);
    expect(compareGender("Male", "Female")).toBeGreaterThan(0);
  });

  it("treats equal answers as equal", () => {
    expect(compareGender("Female", "Female")).toBe(0);
  });

  it("treats null, undefined and empty string as interchangeable", () => {
    // All three mean "no answer", so they must group together rather than
    // splitting into separate runs inside the sorted list.
    expect(compareGender(null, undefined)).toBe(0);
    expect(compareGender(null, "")).toBe(0);
    expect(compareGender(undefined, "  ")).toBe(0);
  });

  it("groups missing values at one end, away from real answers", () => {
    expect(compareGender(null, "Female")).toBeLessThan(0);
    expect(compareGender("Female", null)).toBeGreaterThan(0);
  });

  it("is direction-agnostic so the caller's `cmp * dir` stays correct", () => {
    // The table multiplies the comparator by its sort direction. If this
    // function hard-coded "blanks last" it would invert with the arrow and
    // read as a bug, so a swapped pair must produce the exact negation.
    const forward = compareGender("Female", null);
    const backward = compareGender(null, "Female");
    expect(Math.sign(forward)).toBe(-Math.sign(backward));
  });

  it("sorts a realistic mixed column into a stable, grouped order", () => {
    const rows = ["Male", null, "Female", "Prefer not to answer", "", "Other"];
    const ascending = [...rows].sort(compareGender);

    // Blanks group at the front in ascending order; real answers follow
    // alphabetically. Reversing the direction must mirror it exactly.
    expect(ascending.map(genderLabel)).toEqual([
      GENDER_NOT_PROVIDED,
      GENDER_NOT_PROVIDED,
      "Female",
      "Male",
      "Other",
      "Prefer not to answer",
    ]);

    const descending = [...rows].sort((a, b) => compareGender(a, b) * -1);
    expect(descending.map(genderLabel)).toEqual([
      "Prefer not to answer",
      "Other",
      "Male",
      "Female",
      GENDER_NOT_PROVIDED,
      GENDER_NOT_PROVIDED,
    ]);
  });
});
