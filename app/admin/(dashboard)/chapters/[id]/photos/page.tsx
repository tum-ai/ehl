"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { addChapterPhoto, deleteChapterPhoto, togglePhotoFeatured } from "@/lib/actions/admin";
import { adminUpload } from "@/lib/upload";

interface Photo {
  id: string;
  url: string;
  caption: string | null;
  featured: boolean;
}

interface ChapterInfo {
  id: string;
  name: string;
}

export default function AdminChapterPhotosPage() {
  const params = useParams();
  const chapterId = params.id as string;

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [chapter, setChapter] = useState<ChapterInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    const [photosRes, chapterRes] = await Promise.all([
      fetch(`/api/admin/chapters/${chapterId}/photos`).then((r) => r.json()),
      fetch(`/api/admin/chapters/${chapterId}/details`).then((r) => r.json()),
    ]);
    setPhotos(photosRes);
    setChapter(chapterRes);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

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
        formData.append("folder", `Match Photos/${chapter?.name || chapterId}`);

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
    loadData();
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

  function getImageUrl(fileId: string): string {
    return `https://lh3.googleusercontent.com/d/${fileId}=w400`;
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to {chapter?.name || "chapter"}
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Match Photos</h1>
          <p className="mt-1 ad-text-secondary">{chapter?.name}</p>
        </div>
        <span className="text-sm ad-text-muted">{photos.length} photos</span>
      </div>

      {/* Upload */}
      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider ad-text-muted">
          Upload Photos
        </h2>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          disabled={uploading}
          className="block w-full text-sm ad-text-muted file:mr-4 file:rounded-lg file:border-0 file:ad-bg-accent file:px-4 file:py-2.5 file:text-sm file:font-medium file:ad-text-link file:cursor-pointer hover:file:ad-bg-accent-hover disabled:opacity-50"
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
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative overflow-hidden rounded-xl border ad-border ad-bg-card ui-card-subtle"
            >
              <div className="aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getImageUrl(photo.url)}
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
        <div className="mt-12 text-center">
          <p className="ad-text-muted">No photos uploaded yet.</p>
          <p className="mt-1 text-sm ad-text-muted">
            Upload photos from the match to display them on the public chapter page.
          </p>
        </div>
      )}
    </div>
  );
}
