import { describe, it, expect } from "vitest";
import {
  describeRemoval,
  memberLabel,
  successorLabel,
} from "@/app/admin/(dashboard)/teams/removal-consequence";
import { MIN_TEAM_SIZE } from "@/lib/config/limits";

/**
 * adminRemoveMember no longer refuses a removal that drops a team below
 * MIN_TEAM_SIZE or that targets the captain, so the confirm step is now the
 * ONLY place those consequences are stated. A generic "Are you sure?" would
 * hide exactly the cases worth pausing on.
 */

const base = {
  memberName: "Ada Lovelace",
  teamName: "Alpha Innovators",
  rosterSize: 4,
  isCaptain: false,
  successorName: null,
};

describe("describeRemoval", () => {
  it("asks a plain question for an ordinary removal", () => {
    const { lines, needsAttention } = describeRemoval(base);
    expect(lines).toEqual(["Remove Ada Lovelace from Alpha Innovators?"]);
    expect(needsAttention).toBe(false);
  });

  it("names the successor when the captain is removed", () => {
    const { lines, needsAttention } = describeRemoval({
      ...base,
      isCaptain: true,
      successorName: "Grace Hopper",
    });
    expect(lines.join(" ")).toMatch(/is the captain/);
    expect(lines.join(" ")).toMatch(/Grace Hopper will be promoted/);
    expect(needsAttention).toBe(true);
  });

  it("still warns about the captaincy when no successor name is known", () => {
    const { lines } = describeRemoval({ ...base, isCaptain: true, successorName: null });
    expect(lines.join(" ")).toMatch(/Another member will be promoted/);
  });

  it("states the below-minimum consequence with the actual remaining count", () => {
    const { lines, needsAttention } = describeRemoval({ ...base, rosterSize: 2 });
    expect(lines.join(" ")).toMatch(/with 1 member,/);
    expect(lines.join(" ")).toMatch(new RegExp(`minimum of ${MIN_TEAM_SIZE}`));
    expect(needsAttention).toBe(true);
  });

  it("says the team will be left empty when the last member is removed", () => {
    const { lines, needsAttention } = describeRemoval({ ...base, rosterSize: 1 });
    expect(lines.join(" ")).toMatch(/last member/i);
    expect(lines.join(" ")).toMatch(/left empty/);
    expect(needsAttention).toBe(true);
  });

  // "Empty" and "below the minimum" are both true at rosterSize 1, but only the
  // stronger one is worth saying: two overlapping warnings read as noise.
  it("does not also say 'below the minimum' when the team is emptied", () => {
    const { lines } = describeRemoval({ ...base, rosterSize: 1 });
    expect(lines.join(" ")).not.toMatch(/below the minimum/);
  });

  it("combines the captain warning with the empty-team warning", () => {
    const { lines } = describeRemoval({ ...base, rosterSize: 1, isCaptain: true });
    expect(lines.join(" ")).toMatch(/left empty/);
    // With nobody left there is no promotion to announce.
    expect(lines.join(" ")).not.toMatch(/promoted/);
  });

  it("never reports a negative remaining count", () => {
    const { lines } = describeRemoval({ ...base, rosterSize: 0 });
    expect(lines.join(" ")).not.toMatch(/-1/);
  });
});

describe("memberLabel", () => {
  it("prefers the name, then the email, then a short id", () => {
    expect(memberLabel({ userId: "abcdef123456", profile: { name: "Ada", email: "a@b.c" } })).toBe("Ada");
    expect(memberLabel({ userId: "abcdef123456", profile: { name: null, email: "a@b.c" } })).toBe("a@b.c");
    expect(memberLabel({ userId: "abcdef123456" })).toBe("abcdef12");
  });
});

describe("successorLabel", () => {
  const roster = [
    { userId: "u-new", joinedAt: "2026-08-10T00:00:00Z", profile: { name: "Newest" } },
    { userId: "u-old", joinedAt: "2026-08-01T00:00:00Z", profile: { name: "Oldest" } },
    { userId: "u-mid", joinedAt: "2026-08-05T00:00:00Z", profile: { name: "Middle" } },
  ];

  // Must mirror adminRemoveMember, which orders by joined_at ascending and
  // promotes the first survivor. Naming the wrong person is worse than naming
  // nobody, so the rule is pinned on both sides.
  it("names the longest-tenured survivor", () => {
    expect(successorLabel(roster, "u-new")).toBe("Oldest");
  });

  it("skips the member being removed even when they are the oldest", () => {
    expect(successorLabel(roster, "u-old")).toBe("Middle");
  });

  it("returns null when nobody would be left", () => {
    expect(successorLabel([roster[0]], "u-new")).toBeNull();
  });

  it("is stable on an exact joined_at tie", () => {
    const tied = [
      { userId: "u-b", joinedAt: "2026-08-01T00:00:00Z", profile: { name: "Bee" } },
      { userId: "u-a", joinedAt: "2026-08-01T00:00:00Z", profile: { name: "Ay" } },
    ];
    expect(successorLabel(tied, "u-z")).toBe("Ay");
    expect(successorLabel([...tied].reverse(), "u-z")).toBe("Ay");
  });

  it("survives an unparseable joined_at without crashing", () => {
    const messy = [
      { userId: "u-a", joinedAt: "", profile: { name: "Ay" } },
      { userId: "u-b", joinedAt: "2026-08-01T00:00:00Z", profile: { name: "Bee" } },
    ];
    expect(successorLabel(messy, "u-z")).toBeTruthy();
  });
});
