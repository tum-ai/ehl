"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { deleteChapter } from "@/lib/actions/admin";

interface DeleteChapterButtonProps {
  chapterId: string;
  chapterName: string;
}

/**
 * Destructive, global-admin-only delete for a chapter (match). Deleting a chapter
 * cascades to its challenges, submissions, applications, scores, jury data, etc.,
 * so we require the admin to type the chapter name to confirm before the action
 * runs.
 */
export function DeleteChapterButton({ chapterId, chapterName }: DeleteChapterButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText.trim() === chapterName.trim() && !deleting;

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteChapter(chapterId);
    if (result?.error) {
      setError(result.error);
      setDeleting(false);
      return;
    }
    // Gone: leave the (now-deleted) chapter page for the chapters list.
    router.push("/admin/chapters");
    router.refresh();
  }

  return (
    <Card className="mt-8 ad-border-error">
      <h2 className="mb-2 ad-heading text-lg ad-text-error">Danger zone</h2>
      <p className="text-sm ad-text-muted">
        Deleting this match permanently removes it and all of its challenges,
        submissions, applications, scores and jury data. This cannot be undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-lg border ad-border-error px-4 py-2 text-sm font-bold ad-text-error"
        >
          Delete match
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block text-sm ad-text-muted">
            Type <span className="font-mono font-bold ad-text">{chapterName}</span> to confirm:
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              autoFocus
              disabled={deleting}
            />
          </label>
          {error && <p className="text-sm ad-text-error">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete}
              className="rounded-lg ad-bg-error-solid px-4 py-2 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmText("");
                setError(null);
              }}
              disabled={deleting}
              className="rounded-lg border ad-border px-4 py-2 text-sm font-bold ad-text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
