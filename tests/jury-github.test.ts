import { describe, expect, it } from "vitest";
import {
  normalizeGitHubUsername,
  juryGitHubUsernameNeeded,
} from "@/lib/jury-github";
import type { SubmissionFieldConfig } from "@/lib/types";

const repoField = (
  repoAccess?: SubmissionFieldConfig["repoAccess"]
): SubmissionFieldConfig =>
  ({ key: "repo", label: "Repository", type: "repo", repoAccess }) as SubmissionFieldConfig;

const fileField: SubmissionFieldConfig = {
  key: "deck",
  label: "Pitch deck",
  type: "file",
} as SubmissionFieldConfig;

describe("normalizeGitHubUsername", () => {
  it("accepts a bare username unchanged", () => {
    expect(normalizeGitHubUsername("octocat")).toBe("octocat");
  });

  it("preserves case (GitHub usernames are case-insensitive but display cased)", () => {
    expect(normalizeGitHubUsername("OctoCat")).toBe("OctoCat");
  });

  it("strips a leading @", () => {
    expect(normalizeGitHubUsername("@octocat")).toBe("octocat");
  });

  it("extracts the username from a full profile URL", () => {
    expect(normalizeGitHubUsername("https://github.com/octocat")).toBe("octocat");
  });

  it("extracts from a profile URL with a trailing slash and www", () => {
    expect(normalizeGitHubUsername("https://www.github.com/octocat/")).toBe("octocat");
  });

  it("extracts from a bare github.com path", () => {
    expect(normalizeGitHubUsername("github.com/octo-cat")).toBe("octo-cat");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGitHubUsername("  octocat  ")).toBe("octocat");
  });

  it("allows internal single hyphens and digits", () => {
    expect(normalizeGitHubUsername("octo-cat-9")).toBe("octo-cat-9");
  });

  it("allows the maximum length of 39 characters", () => {
    const max = "a".repeat(39);
    expect(normalizeGitHubUsername(max)).toBe(max);
  });

  // The rejections matter as much as the acceptances: an invalid username is
  // stored, then fails days later at lock time when nobody is watching.
  it("rejects 40 characters", () => {
    expect(normalizeGitHubUsername("a".repeat(40))).toBeNull();
  });

  it("rejects an email address, the most likely admin mistake", () => {
    expect(normalizeGitHubUsername("jury@sponsor.com")).toBeNull();
  });

  it("rejects a leading hyphen", () => {
    expect(normalizeGitHubUsername("-octocat")).toBeNull();
  });

  it("rejects a trailing hyphen", () => {
    expect(normalizeGitHubUsername("octocat-")).toBeNull();
  });

  it("rejects consecutive hyphens", () => {
    expect(normalizeGitHubUsername("octo--cat")).toBeNull();
  });

  it("rejects underscores and spaces", () => {
    expect(normalizeGitHubUsername("octo_cat")).toBeNull();
    expect(normalizeGitHubUsername("octo cat")).toBeNull();
  });

  it("rejects empty, whitespace-only, null and undefined", () => {
    expect(normalizeGitHubUsername("")).toBeNull();
    expect(normalizeGitHubUsername("   ")).toBeNull();
    expect(normalizeGitHubUsername(null)).toBeNull();
    expect(normalizeGitHubUsername(undefined)).toBeNull();
  });
});

describe("juryGitHubUsernameNeeded", () => {
  it("is needed when jury go to forks and the repo must be private", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: true,
        submissionFields: [repoField("invite_required")],
      })
    ).toBe(true);
  });

  it("is needed for repoAccess 'any', where a team may still pick private", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: true,
        submissionFields: [repoField("any")],
      })
    ).toBe(true);
  });

  it("defaults an unset repoAccess to needed, matching the admin UI default", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: true,
        submissionFields: [repoField(undefined)],
      })
    ).toBe(true);
  });

  it("is NOT needed for a public repo: the fork is public, no invite needed", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: true,
        submissionFields: [repoField("public")],
      })
    ).toBe(false);
  });

  it("is NOT needed when jury are not invited to forks at all", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: false,
        submissionFields: [repoField("invite_required")],
      })
    ).toBe(false);
  });

  it("is NOT needed when the challenge has no repo field", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: true,
        submissionFields: [fileField],
      })
    ).toBe(false);
  });

  it("is needed if ANY repo field permits private, even alongside a public one", () => {
    expect(
      juryGitHubUsernameNeeded({
        inviteJuryToForks: true,
        submissionFields: [repoField("public"), repoField("invite_required")],
      })
    ).toBe(true);
  });

  it("handles missing, null and empty field lists without throwing", () => {
    expect(juryGitHubUsernameNeeded({ inviteJuryToForks: true, submissionFields: [] })).toBe(false);
    expect(juryGitHubUsernameNeeded({ inviteJuryToForks: true, submissionFields: null })).toBe(false);
    expect(juryGitHubUsernameNeeded(null)).toBe(false);
    expect(juryGitHubUsernameNeeded(undefined)).toBe(false);
  });
});
