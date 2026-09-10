import { getSettingValue, SETTING_KEYS } from "@/lib/settings";
import { listEntireCheckpointRefs } from "@/lib/entire";

const EHL_GITHUB_USERNAME = "ehl-gg";

async function getOrg(): Promise<string> {
  const org = await getSettingValue(SETTING_KEYS.GITHUB_ORG, process.env.GITHUB_ORG);
  return org || "european-hackathon-league";
}

async function getGitHubToken(): Promise<string | null> {
  return getSettingValue(SETTING_KEYS.GITHUB_TOKEN, process.env.GITHUB_TOKEN);
}

/**
 * Parse a GitHub repo URL into owner/repo.
 * Accepts: https://github.com/owner/repo, github.com/owner/repo, owner/repo
 */
export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");

  const urlMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  const shortMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  return null;
}

export function getEhlUsername(): string {
  return EHL_GITHUB_USERNAME;
}

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  const token = await getGitHubToken();
  if (token) {
    headers.Authorization = `token ${token}`;
  }
  return headers;
}

// ─── Accept pending collaborator invitations ──────────────────

/**
 * Check for a pending repository invitation for ehl-gg and accept it.
 * Uses GET /user/repository_invitations to list pending invites,
 * then PATCH /user/repository_invitations/:id to accept.
 * Returns true if an invite was found and accepted.
 */
export async function acceptPendingInvite(
  owner: string,
  repo: string
): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) return false;

  const headers = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `token ${token}`,
  };

  // List all pending invitations for the authenticated user (ehl-gg)
  const res = await fetch("https://api.github.com/user/repository_invitations?per_page=100", {
    headers,
  });
  if (!res.ok) return false;

  const invitations = await res.json();
  const fullName = `${owner}/${repo}`.toLowerCase();
  const invite = invitations.find(
    (inv: { repository: { full_name: string } }) =>
      inv.repository.full_name.toLowerCase() === fullName
  );

  if (!invite) return false;

  // Accept the invitation
  const acceptRes = await fetch(
    `https://api.github.com/user/repository_invitations/${invite.id}`,
    { method: "PATCH", headers }
  );

  return acceptRes.status === 204;
}

// ─── Snapshot: fork repo into EHL org ─────────────────────────

/**
 * Snapshot a repo by forking it into the EHL org.
 *
 * - First submission: creates a fork (single API call)
 * - Repeated submissions: syncs the existing fork with upstream
 * - Private repos stay private, public forks stay public
 */
export async function snapshotRepo(
  owner: string,
  repo: string,
  snapshotName: string,
  description: string
): Promise<{ snapshotUrl: string } | { error: string }> {
  const token = await getGitHubToken();
  if (!token) {
    return { error: "GitHub token not configured." };
  }

  const headers = await getHeaders();
  const org = await getOrg();
  const forkFullName = `${org}/${snapshotName}`;

  try {
    // Check if fork already exists
    const existingRes = await fetch(`https://api.github.com/repos/${forkFullName}`, { headers });

    if (existingRes.status === 200) {
      // Fork exists: sync with upstream to get latest changes
      const repoData = await existingRes.json();
      const defaultBranch = repoData.default_branch || "main";

      await fetch(`https://api.github.com/repos/${forkFullName}/merge-upstream`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ branch: defaultBranch }),
      }).catch((err) => console.error(`Failed to merge upstream for ${forkFullName}:`, err));

      return { snapshotUrl: `https://github.com/${forkFullName}` };
    }

    // Fork doesn't exist: create it
    const forkRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/forks`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: org,
          name: snapshotName,
          default_branch_only: true,
        }),
      }
    );

    if (forkRes.status === 202 || forkRes.status === 200) {
      const forkData = await forkRes.json();
      const forkUrl = forkData.html_url || `https://github.com/${forkFullName}`;

      // Update description
      await fetch(`https://api.github.com/repos/${forkFullName}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      }).catch(() => {});

      return { snapshotUrl: forkUrl };
    }

    // 422 can mean name conflict from a different source repo
    if (forkRes.status === 422) {
      const errBody = await forkRes.json().catch(() => ({}));
      const msg = errBody?.message || "";
      if (msg.includes("already exists") || msg.includes("name already exists")) {
        return { snapshotUrl: `https://github.com/${forkFullName}` };
      }
    }

    const errText = await forkRes.text().catch(() => "");
    console.error(`Fork failed for ${owner}/${repo}:`, forkRes.status, errText);
    return { error: `Could not fork repository (${forkRes.status}): ${errText}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fork failed";
    console.error(`Fork failed for ${owner}/${repo}:`, message);
    return { error: message };
  }
}

// ─── Entire checkpoint branch capture ───────────────────────

/**
 * Copy the Entire session-history branch (entire/checkpoints/v1, or the v1.1
 * mirror ref) from a source repo into its EHL fork.
 *
 * Why this is needed: snapshotRepo forks with default_branch_only, and forks do
 * not auto-sync non-default branches. The session record therefore never reaches
 * the fork unless we copy it explicitly. Because the fork lives in the same git
 * object network as its parent, we can point a ref in the fork at the source's
 * checkpoint commit without cloning any objects.
 *
 * Capturing into the (private) fork is deliberate: it keeps prompt transcripts —
 * which Entire stores best-effort-redacted and which include UNREDACTED code-file
 * snapshots — out of any public path and under EHL control for the jury pipeline.
 *
 * Best-effort: returns the ref copied, or null if the source has no checkpoint
 * branch or the copy fails. NEVER throws into the snapshot flow.
 */
export async function fetchCheckpointBranchIntoFork(
  owner: string,
  repo: string,
  snapshotName: string
): Promise<{ ref: string } | null> {
  const token = await getGitHubToken();
  if (!token) return null;
  const headers = await getHeaders();
  const org = await getOrg();
  const forkFullName = `${org}/${snapshotName}`;

  // Candidate refs mirror lib/entire.ts, same order: the ref based backend's
  // dynamic refs/entire/checkpoints/<shard>/<id> refs first, legacy branch and
  // v1.1 mirror as fallback. All matching refs are copied, not just the first.
  const candidates = [
    ...(await listEntireCheckpointRefs(owner, repo, headers)).map((ref) => ({
      srcRef: ref.slice("refs/".length),
      dstRef: ref,
    })),
    { srcRef: "heads/entire/checkpoints/v1", dstRef: "refs/heads/entire/checkpoints/v1" },
    { srcRef: "entire/checkpoints/v1.1", dstRef: "refs/entire/checkpoints/v1.1" },
  ];

  let copiedRef: string | null = null;
  for (const { srcRef, dstRef } of candidates) {
    try {
      const srcRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/${srcRef}`,
        { headers }
      );
      if (!srcRes.ok) continue; // ref not on source: try next candidate
      const srcData = (await srcRes.json()) as { object?: { sha?: string } };
      const sha = srcData.object?.sha;
      if (!sha) continue;

      // Try to create the ref in the fork. If it already exists, update it.
      const createRes = await fetch(
        `https://api.github.com/repos/${forkFullName}/git/refs`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ ref: dstRef, sha }),
        }
      );

      if (createRes.ok) {
        copiedRef = dstRef;
        continue;
      }

      if (createRes.status === 422) {
        // Ref exists already: fast-forward (force) it to the source SHA.
        const updateRes = await fetch(
          `https://api.github.com/repos/${forkFullName}/git/${dstRef}`,
          {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ sha, force: true }),
          }
        );
        if (updateRes.ok) {
          copiedRef = dstRef;
          continue;
        }
      }

      const errText = await createRes.text().catch(() => "");
      console.error(
        `Could not copy checkpoint ref ${srcRef} into ${forkFullName}:`,
        createRes.status,
        errText
      );
      // Keep trying other checkpoint refs. A single malformed or inaccessible
      // checkpoint must not hide usable refs from the same repository.
      continue;
    } catch (e) {
      console.error(
        `Checkpoint ref copy error for ${owner}/${repo} -> ${forkFullName}:`,
        e instanceof Error ? e.message : String(e)
      );
      continue;
    }
  }

  return copiedRef ? { ref: copiedRef } : null;
}

// ─── Collaborator management ────────────────────────────────

/** One person to invite onto a snapshot fork. */
export type CollaboratorInvitee = {
  email: string;
  /** Bare GitHub username, when we captured one at jury-invite time. */
  githubUsername?: string | null;
};

/** Per-invitee outcome, so callers can report failures instead of losing them. */
export type CollaboratorInviteResult = {
  email: string;
  username: string | null;
  /** "username" = used the stored one, "email_search" = resolved by lookup. */
  resolvedBy: "username" | "email_search" | null;
  invited: boolean;
  error?: string;
};

/**
 * Add collaborators to a repository with read access.
 *
 * Resolution order per person:
 *  1. The GitHub username stored on their profile (captured at jury-invite
 *     time). This is the reliable path.
 *  2. Falling back to `search/users?q=<email>+in:email`, which ONLY matches
 *     users who made that address public on their GitHub profile. Kept for
 *     jurors invited before usernames were collected, but it is a long shot.
 *
 * Returns a per-invitee result. Callers MUST surface failures: a juror who
 * never gets access to a private fork cannot judge, and the old
 * silently-skip-on-miss behavior meant nobody found out until the jury
 * complained.
 */
export async function addCollaborators(
  owner: string,
  repo: string,
  invitees: CollaboratorInvitee[]
): Promise<CollaboratorInviteResult[]> {
  const token = await getGitHubToken();
  if (!token) {
    return invitees.map((i) => ({
      email: i.email,
      username: i.githubUsername ?? null,
      resolvedBy: null,
      invited: false,
      error: "GitHub token not configured.",
    }));
  }

  const headers = await getHeaders();
  const results: CollaboratorInviteResult[] = [];

  for (const invitee of invitees) {
    const stored = invitee.githubUsername?.trim() || null;
    let username = stored;
    let resolvedBy: CollaboratorInviteResult["resolvedBy"] = stored ? "username" : null;

    try {
      if (!username) {
        const searchRes = await fetch(
          `https://api.github.com/search/users?q=${encodeURIComponent(invitee.email)}+in:email`,
          { headers }
        );

        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.items?.length) {
            username = searchData.items[0].login as string;
            resolvedBy = "email_search";
          }
        }
      }

      if (!username) {
        results.push({
          email: invitee.email,
          username: null,
          resolvedBy: null,
          invited: false,
          error:
            "No GitHub username on file and no public GitHub account matches this email. Ask the juror for their GitHub username.",
        });
        continue;
      }

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
        {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ permission: "read" }),
        }
      );

      // 201 = invitation created, 204 = already a collaborator. Both are fine.
      if (res.status === 201 || res.status === 204) {
        results.push({ email: invitee.email, username, resolvedBy, invited: true });
        continue;
      }

      const errText = await res.text().catch(() => "");
      console.error(
        `Could not invite ${username} to ${owner}/${repo}:`,
        res.status,
        errText
      );
      results.push({
        email: invitee.email,
        username,
        resolvedBy,
        invited: false,
        error: `GitHub rejected the invite (${res.status}). Check the username is correct.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invite failed";
      console.error(`Collaborator invite error for ${invitee.email}:`, message);
      results.push({
        email: invitee.email,
        username,
        resolvedBy,
        invited: false,
        error: message,
      });
    }
  }

  return results;
}

/**
 * Delete a snapshot repo (cleanup after jury phase).
 */
export async function deleteSnapshotRepo(repoName: string): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) return false;

  const org = await getOrg();
  const headers = await getHeaders();

  const res = await fetch(
    `https://api.github.com/repos/${org}/${repoName}`,
    {
      method: "DELETE",
      headers,
    }
  );

  return res.status === 204;
}
