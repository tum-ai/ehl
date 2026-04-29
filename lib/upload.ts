/**
 * Client-side admin upload helper with automatic image compression fallback.
 * When an upload fails with 413 (payload too large), the image is compressed
 * client-side and retried automatically.
 */

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.8;

export interface UploadResult {
  url?: string;
  fileId?: string;
  error?: string;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Image compression failed"));
            return;
          }
          const compressed = new File(
            [blob],
            file.name.replace(/\.\w+$/, ".jpg"),
            { type: "image/jpeg" }
          );
          resolve(compressed);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };

    img.src = url;
  });
}

/**
 * Upload a file to /api/admin/upload with automatic compression retry on 413.
 * Pass the same FormData fields you would normally (file, bucket, folder).
 */
export async function adminUpload(formData: FormData): Promise<UploadResult> {
  const res = await fetch("/api/admin/upload", { method: "POST", body: formData });

  if (res.status === 413) {
    // Payload too large: try compressing if it's an image
    const file = formData.get("file") as File | null;
    if (!file || !isImageFile(file)) {
      return { error: "File is too large to upload (max ~4 MB)." };
    }

    let compressed: File;
    try {
      compressed = await compressImage(file);
    } catch {
      return { error: "File is too large and could not be compressed automatically." };
    }

    // Retry with compressed image
    const retryData = new FormData();
    retryData.set("file", compressed);
    // Copy over other fields (bucket, folder)
    for (const [key, value] of formData.entries()) {
      if (key !== "file") retryData.set(key, value);
    }

    const retryRes = await fetch("/api/admin/upload", { method: "POST", body: retryData });
    if (retryRes.status === 413) {
      return { error: "Image is still too large after compression. Please use a smaller file." };
    }
    if (!retryRes.ok) {
      const data = await retryRes.json().catch(() => null);
      return { error: data?.error || "Upload failed after compression." };
    }
    return await retryRes.json();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return { error: data?.error || `Upload failed (${res.status}).` };
  }

  return await res.json();
}
