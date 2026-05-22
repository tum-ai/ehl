"use client";

import { useState } from "react";
import { deleteParticipant } from "@/lib/actions/admin";
import { useRouter } from "next/navigation";

interface Props {
  userId: string;
  name: string;
  email: string;
}

export function DeleteParticipantButton({ userId, name, email }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    const result = await deleteParticipant(userId);
    if (result.error) {
      setError(result.error);
      setDeleting(false);
    } else {
      setShowConfirm(false);
      router.refresh();
    }
  }

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="text-xs ad-text-error hover:text-red-700 transition-colors"
        title="Delete participant"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl ad-border ad-bg-card p-6">
        <h3 className="ad-heading text-lg ad-text-error">Delete Participant</h3>
        <p className="mt-2 text-sm ad-text-secondary">
          This will permanently delete <strong className="ad-text">{name || email}</strong> and remove them from any team, applications, and authentication. This cannot be undone.
        </p>
        <p className="mt-2 text-xs ad-text-muted">{email}</p>
        {error && (
          <p className="mt-2 text-sm ad-text-error">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => {
              setShowConfirm(false);
              setError(null);
            }}
            className="rounded-lg px-4 py-2 text-sm ad-text-muted hover:ad-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg ad-bg-error px-4 py-2 text-sm font-medium ad-text-error transition-colors hover:bg-red-100 disabled:opacity-30"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
