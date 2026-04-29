import { getSettingValue, SETTING_KEYS } from "@/lib/settings";

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

// ─── Collaborator management ────────────────────────────────

/**
 * Add collaborators to a repository by email.
 * Looks up GitHub usernames by email, then invites them with read access.
 * Silently skips emails where no GitHub user is found.
 */
export async function addCollaborators(
  owner: string,
  repo: string,
  emails: string[]
): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;

  const headers = await getHeaders();

  for (const email of emails) {
    try {
      const searchRes = await fetch(
        `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
        { headers }
      );

      if (!searchRes.ok) continue;

      const searchData = await searchRes.json();
      if (!searchData.items || searchData.items.length === 0) continue;

      const username = searchData.items[0].login;

      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`,
        {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ permission: "read" }),
        }
      );
    } catch {
      // Skip failed invitations
    }
  }
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
