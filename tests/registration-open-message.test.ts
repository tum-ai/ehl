import { describe, it, expect } from "vitest";
import { noTeamRegistrationMessage } from "@/components/chapter/chapter-registration-open";

describe("noTeamRegistrationMessage", () => {
  it("tells a logged-out visitor to log in", () => {
    const msg = noTeamRegistrationMessage(null, false);
    expect(msg).toBe("Log in to see your team status and register for a challenge.");
  });

  it("tells a logged-in participant without a team to join or create one (the bug)", () => {
    // Accepted, teamless participant: session exists but no team, so userRole is null.
    // They must NOT be told to log in.
    const msg = noTeamRegistrationMessage(null, true);
    expect(msg).not.toContain("Log in");
    expect(msg).toContain("not on a team");
    expect(msg).toContain("Join");
    // Must surface the two-member minimum to register for a challenge.
    expect(msg).toContain("two members");
  });

  it("tells a team member (with a team) to check in at the event", () => {
    const msg = noTeamRegistrationMessage("member", true);
    expect(msg).toContain("check in");
    expect(msg).not.toContain("Log in");
    expect(msg).not.toContain("not on a team");
  });

  it("tells a team president (with a team) to check in at the event", () => {
    const msg = noTeamRegistrationMessage("president", true);
    expect(msg).toContain("check in");
    expect(msg).not.toContain("Log in");
  });
});
