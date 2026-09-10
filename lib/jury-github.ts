import type { Challenge, SubmissionFieldConfig } from "@/lib/types";

/**
 * GitHub username handling for jury fork invitations.
 *
 * Client-safe (no server imports) so the admin invite form and the server
 * action validate with the SAME predicate, mirroring lib/showcase-shared.ts.
 *
 * Why this exists: to add a juror to a PRIVATE snapshot fork, GitHub's
 * collaborator API needs a *username*. All we hold is the EHL account email the
 * admin typed at invite time, which is frequently not the address on the
 * juror's GitHub account, and email lookup only ever matched jurors who made
 * that address public on their profile. Those misses were silent, so the jury
 * simply never received access to the code they were meant to judge.
 */

/**
 * GitHub's own rules: 1-39 chars, alphanumeric or single hyphens, no leading or
 * trailing hyphen. Deliberately strict: a username we cannot invite is worse
 * than a rejected form, because the failure surfaces days later at lock time.
 */
const GITHUB_USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * Accept what an admin will realistically paste: a bare username, an @handle,
 * or a full profile URL. Returns the bare username, or null if it is not a
 * syntactically valid GitHub username.
 */
export function normalizeGitHubUsername(
  input: string | null | undefined
): string | null {
  if (!input || typeof input !== "string") return null;
  let value = input.trim();
  if (!value) return null;

  // Full or partial profile URL: take the first path segment.
  const urlMatch = value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i);
  if (urlMatch) value = urlMatch[1];

  value = value.replace(/^@/, "").replace(/\/+$/, "").trim();
  if (!GITHUB_USERNAME_RE.test(value)) return null;

  return value;
}

type RepoAccessChallenge = Pick<Challenge, "inviteJuryToForks"> & {
  submissionFields?: SubmissionFieldConfig[] | null;
};

/**
 * Does inviting jury to this challenge's forks require a GitHub username?
 *
 * Only when BOTH hold:
 *  - the challenge invites jury to the snapshot forks at all, and
 *  - at least one repo field permits a PRIVATE repo ("invite_required", or
 *    "any", where a team may still choose private).
 *
 * A fork of a public repo is public, so a juror opens it with no collaborator
 * invite and no GitHub account: demanding a username there would be friction
 * that buys nothing.
 */
export function juryGitHubUsernameRequired(
  challenge: RepoAccessChallenge | null | undefined
): boolean {
  if (!challenge?.inviteJuryToForks) return false;
  const fields = challenge.submissionFields ?? [];
  return fields.some(
    (f) => f.type === "repo" && (f.repoAccess ?? "invite_required") !== "public"
  );
}
