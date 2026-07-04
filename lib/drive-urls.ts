// Client-safe Google Drive URL builders.
//
// Deliberately separate from lib/gdrive.ts, which imports googleapis and is
// server-only. Both the public chapter gallery and the partner showcase render
// Drive-hosted photos; these helpers are the single place that knows the URL
// shapes, so a Drive-side format change is a one-file fix.

/** Public thumbnail for a Drive-hosted image (requested at the given width). */
export function driveThumbnailUrl(fileId: string, width = 400): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${width}`;
}

/** Drive viewer page for the full-size file. */
export function drivePhotoViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
