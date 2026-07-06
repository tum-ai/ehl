"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { addChapterPhoto, deleteChapterPhoto, togglePhotoFeatured } from "@/lib/actions/admin";
import { adminUpload } from "@/lib/upload";
import { driveThumbnailUrl } from "@/lib/drive-urls";

interface Photo {
  id: string;
  url: string;
  caption: string | null;
  featured: boolean;
}

// Per-chapter photo management (upload / feature / delete), extracted from the
// standalone photos page so it can ALSO live on the Partner Showcase admin page:
// the photos a sponsor sees are managed right where the sponsor link is managed.
// Self-loads its photo list; the caller provides chapter id + name only.
export function ChapterPhotosManager({
  chapterId,
  chapterName,
  description,
}: {
  chapterId: string;
  chapterName: string;
  description?: string;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    const res = await fetch(`/api/admin/chapters/${chapterId}/photos`)
      .then((r) => r.json())
      .catch(() => []);
    setPhotos(Array.isArray(res) ? res : []);
  }, [chapterId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);
    setUploadCount(0);
    setUploadTotal(files.length);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (!file.type.startsWith("image/")) {
        setError(`Skipped ${file.name}: not an image.`);
        continue;
      }

      if (file.size > 20 * 1024 * 1024) {
        setError(`Skipped ${file.name}: exceeds 20MB.`);
        continue;
      }

      try {
        // Upload to Google Drive (with compression fallback for large images)
        const formData = new FormData();
        formData.append("file", file);
        formData.append("bucket", "match-photos");
        formData.append("folder", `Match Photos/${chapterName || chapterId}`);

        const result = await adminUpload(formData);
        if (result.error || !result.fileId) {
          setError(`Failed to upload ${file.name}: ${result.error || "No file ID returned"}`);
          continue;
        }

        // Save to media table with GDrive file ID
        await addChapterPhoto(chapterId, result.fileId);
        setUploadCount(i + 1);
      } catch {
        setError(`Failed to upload ${file.name}.`);
      }
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    loadPhotos();
  }

  async function handleDelete(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    const result = await deleteChapterPhoto(photoId, chapterId);
    if (result.error) {
      setError(result.error);
    } else {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    }
  }

  async function handleToggleFeatured(photoId: string, featured: boolean) {
    await togglePhotoFeatured(photoId, featured, chapterId);
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, featured } : p))
    );
  }

  return (
    <div>
      {/* Upload */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider ad-text-muted">
            Upload Photos
          </h2>
          <span className="text-sm ad-text-muted">{photos.length} photos</span>
        </div>
        {description && (
          <p className="mt-2 text-sm ad-text-secondary">{description}</p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          disabled={uploading}
          className="mt-3 block w-full text-sm ad-text-muted file:mr-4 file:rounded-lg file:border-0 file:ad-bg-accent file:px-4 file:py-2.5 file:text-sm file:font-medium file:ad-text-link file:cursor-pointer hover:file:ad-bg-accent-hover disabled:opacity-50"
        />
        <p className="mt-2 text-xs ad-text-muted">
          Select multiple images. Max 20MB per file. Stored in Google Drive.
        </p>

        {uploading && (
          <div className="mt-3">
            <div className="h-2 rounded-full ad-bg-elevated">
              <div
                className="h-2 rounded-full bg-gold transition-all"
                style={{ width: `${(uploadCount / uploadTotal) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs ad-text-muted">
              Uploading {uploadCount}/{uploadTotal}...
            </p>
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm ad-text-error">{error}</p>
        )}
      </Card>

      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative overflow-hidden rounded-xl border ad-border ad-bg-card ui-card-subtle"
            >
              <div className="aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={driveThumbnailUrl(photo.url)}
                  alt={photo.caption || "Match photo"}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>

              {/* Featured badge */}
              {photo.featured && (
                <div className="absolute top-2 left-2 rounded-full bg-gold/90 px-2 py-0.5 text-[10px] font-bold text-surface-deep">
                  Featured
                </div>
              )}

              {/* Actions overlay */}
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex w-full items-center justify-between p-3">
                  <button
                    onClick={() => handleToggleFeatured(photo.id, !photo.featured)}
                    className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/20"
                  >
                    {photo.featured ? "Unfeature" : "Feature"}
                  </button>
                  <button
                    onClick={() => handleDelete(photo.id)}
                    className="rounded-lg ad-bg-error px-2.5 py-1.5 text-xs font-medium ad-text-error backdrop-blur-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {photos.length === 0 && !uploading && (
        <p className="mt-6 text-center text-sm ad-text-muted">
          No photos uploaded yet.
        </p>
      )}
    </div>
  );
}
