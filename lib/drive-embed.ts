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
 */
export function extractDriveFileId(url: string): string | null {
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
