/**
 * Utility functions for participant flag matching.
 * Extracts normalized identifiers from URLs and names
 * for cross-email matching during screening.
 */

/**
 * Extract LinkedIn username from a URL.
 * Handles: linkedin.com/in/johndoe, https://www.linkedin.com/in/johndoe/, etc.
 * Returns null if URL is empty or doesn't match the expected pattern.
 */
export function extractLinkedInUsername(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match || !match[1]) return null;
  return match[1].toLowerCase().replace(/\/+$/, "");
}

/**
 * Extract GitHub username from a URL.
 * Handles: github.com/johndoe, https://github.com/johndoe/somerepo, etc.
 * Returns null if URL is empty or doesn't match the expected pattern.
 */
export function extractGitHubUsername(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/github\.com\/([^/?#]+)/i);
  if (!match || !match[1]) return null;
  const username = match[1].toLowerCase();
  // Filter out GitHub reserved paths
  if (["orgs", "settings", "notifications", "pulls", "issues", "explore", "topics", "trending", "collections"].includes(username)) {
    return null;
  }
  return username;
}

/**
 * Normalize a name for matching: lowercase, trim, collapse whitespace.
 * Returns null if both parts are empty.
 */
export function normalizeName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  const parts = [firstName, lastName]
    .filter(Boolean)
    .map((s) => (s as string).trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  return parts.join(" ").toLowerCase().replace(/\s+/g, " ");
}
