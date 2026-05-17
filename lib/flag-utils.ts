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

/**
 * Tokenize a name into sorted, lowercased parts for fuzzy matching.
 * Handles middle names, different orderings, and diacritics.
 */
function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z\s]/g, "") // remove non-alpha
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .sort();
}

/**
 * Calculate similarity between two names using token-based matching.
 * Returns a score from 0 to 1, where 1 is a perfect match.
 * Handles: different orderings, middle names, partial matches.
 */
export function nameSimilarity(nameA: string, nameB: string): number {
  const tokensA = tokenizeName(nameA);
  const tokensB = tokenizeName(nameB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  // Exact token match after sorting
  if (tokensA.join(" ") === tokensB.join(" ")) return 1;

  // Count matching tokens (handles middle names by finding subset matches)
  let matches = 0;
  const usedB = new Set<number>();

  for (const tokenA of tokensA) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < tokensB.length; i++) {
      if (usedB.has(i)) continue;
      const score = tokenLevenshteinSimilarity(tokenA, tokensB[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.75) {
      matches += bestScore;
      usedB.add(bestIdx);
    }
  }

  // Score: matched tokens / max token count (penalizes extra/missing names)
  const maxTokens = Math.max(tokensA.length, tokensB.length);
  return matches / maxTokens;
}

/**
 * Levenshtein-based similarity for individual name tokens.
 * Returns value between 0 and 1.
 */
function tokenLevenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen;
}

/**
 * Find the best fuzzy match for a name in a list of member names.
 * Returns the match and score, or null if no match exceeds the threshold.
 */
export function findBestNameMatch(
  applicantName: string,
  memberNames: string[],
  threshold = 0.7
): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;

  for (const memberName of memberNames) {
    const score = nameSimilarity(applicantName, memberName);
    if (score >= threshold && (!best || score > best.score)) {
      best = { name: memberName, score };
    }
  }

  return best;
}
