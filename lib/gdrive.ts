import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";

// Drive calls default to no timeout; a hung request would otherwise hang the
// whole submission until the serverless function is killed. Bound them so a
// Drive outage surfaces as a fast error instead of a stuck spinner.
const DRIVE_TIMEOUT_MS = 10_000; // metadata ops (list/create folder)
const DRIVE_UPLOAD_TIMEOUT_MS = 30_000; // file upload (larger payload)

// ─── Auth ───────────────────────────────────────────────────

function getCredentials() {
  const base64 = process.env.GOOGLE_DRIVE_CREDENTIALS;
  if (base64) {
    return JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
  }
  throw new Error("GOOGLE_DRIVE_CREDENTIALS env var is not set");
}

function getDrive(): drive_v3.Drive {
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID env var is not set");
  return id;
}

// ─── Folder Management ─────────────────────────────────────

/**
 * Find or create a folder inside a parent folder.
 * Returns the folder ID.
 */
async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string
): Promise<string> {
  // Search for existing folder
  const res = await drive.files.list(
    {
      q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      spaces: "drive",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "drive",
      driveId: getRootFolderId(),
    },
    { timeout: DRIVE_TIMEOUT_MS }
  );

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  // Create folder
  const folder = await drive.files.create(
    {
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    },
    { timeout: DRIVE_TIMEOUT_MS }
  );

  return folder.data.id!;
}

/**
 * Ensure a nested folder path exists, e.g. ["CVs", "Munich Makeathon 2026"].
 * Returns the ID of the deepest folder.
 */
export async function ensureFolderPath(path: string[]): Promise<string> {
  const drive = getDrive();
  let parentId = getRootFolderId();

  for (const segment of path) {
    parentId = await findOrCreateFolder(drive, segment, parentId);
  }

  return parentId;
}

// ─── File Upload ────────────────────────────────────────────

export interface UploadResult {
  fileId: string;
  webViewLink: string;
  webContentLink: string | null;
}

/**
 * Upload a file to Google Drive (Shared Drive).
 *
 * @param file       - The file to upload (File or Buffer)
 * @param fileName   - Display name of the file in Drive
 * @param mimeType   - MIME type of the file
 * @param folderPath - Array of folder segments under the root, e.g. ["CVs", "Munich 2026"]
 * @param maxSizeMB  - Maximum file size in MB (default 20)
 */
export async function uploadFile(
  file: File | Buffer,
  fileName: string,
  mimeType: string,
  folderPath: string[],
  maxSizeMB = 20
): Promise<UploadResult> {
  // Size check
  const size = file instanceof File ? file.size : file.length;
  if (size > maxSizeMB * 1024 * 1024) {
    throw new Error(`File exceeds ${maxSizeMB}MB limit.`);
  }

  const drive = getDrive();
  const folderId = await ensureFolderPath(folderPath);

  // Convert to stream
  let body: Readable;
  if (file instanceof File) {
    const buffer = Buffer.from(await file.arrayBuffer());
    body = Readable.from(buffer);
  } else {
    body = Readable.from(file);
  }

  const res = await drive.files.create(
    {
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body,
      },
      fields: "id, webViewLink, webContentLink",
      supportsAllDrives: true,
    },
    { timeout: DRIVE_UPLOAD_TIMEOUT_MS }
  );

  const fileId = res.data.id!;

  return {
    fileId,
    webViewLink: res.data.webViewLink!,
    webContentLink: res.data.webContentLink || null,
  };
}


/**
 * Download a file's content as a Buffer via the service account.
 * Used for proxying files through our own API (no public access needed).
 */
export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = getDrive();

  // Get file metadata for MIME type
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });

  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );

  return {
    buffer: Buffer.from(response.data as ArrayBuffer),
    mimeType: (meta.data.mimeType as string) || "application/octet-stream",
  };
}

// ─── File Access ────────────────────────────────────────────

/**
 * Get a direct download/view link for a file.
 */
export function getViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function getDownloadLink(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export function getThumbnailLink(fileId: string, width = 800): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${width}`;
}

/**
 * Delete a file from Google Drive.
 * Requires "Content Manager" or higher role on Shared Drives.
 */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDrive();
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}
