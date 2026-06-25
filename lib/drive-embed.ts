/**
 * Helpers for embedding Google Drive files as inline previews.
 *
 * Shared by the admin and jury submission detail pages, which both render a
 * Drive `/preview` iframe for file-type submission fields (e.g. pitch decks).
 * Kept framework-agnostic (pure functions, no Drive API calls) so it can run in
 * both server and client components.
 */

/**
 * Extract a Google Drive file ID from the common URL formats we store:
 *   - https://drive.google.com/file/d/{id}/view
 *   - https://drive.google.com/uc?export=download&id={id}
 *   - https://drive.google.com/open?id={id}
 * Returns null if the URL is not a recognizable Drive link.
 *
 * The host MUST be a real Google Drive/Docs host. Submission `fields` are
 * client-supplied JSON, so without this check a tampered value like
 * `https://evil.example.com/?id=ID` or `/file/d/ID` on any host would be treated
 * as a Drive file and flow into the embed iframe and the link-readable
 * self-heal. Restricting the host keeps both paths to genuine Drive URLs.
 */
const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com",
]);

export function extractDriveFileId(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null; // not an absolute URL -> not a Drive link
  }
  if (!DRIVE_HOSTS.has(host)) return null;

  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  const openMatch = url.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];
  return null;
}

/**
 * Build the inline-preview embed URL for a Drive file URL, or null if the URL
 * is not a Drive link.
 */
export function getDriveEmbedUrl(url: string): string | null {
  const fileId = extractDriveFileId(url);
  if (!fileId) return null;
  return `https://drive.google.com/file/d/${fileId}/preview`;
}
