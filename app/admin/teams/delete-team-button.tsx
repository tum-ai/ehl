"use client";

import { useState } from "react";
import { deleteTeam } from "@/lib/actions/admin";
import { useRouter } from "next/navigation";

interface DeleteTeamButtonProps {
  teamId: string;
  teamName: string;
}

export function DeleteTeamButton({ teamId, teamName }: DeleteTeamButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    if (confirmText !== teamName) return;
    setDeleting(true);
    setError(null);

    const result = await deleteTeam(teamId);
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
        className="text-sm font-medium ad-text-error hover:text-red-700 transition-colors"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl ad-border ad-bg-card p-6">
        <h3 className="ad-heading text-lg ad-text-error">Delete Team</h3>
        <p className="mt-2 text-sm ad-text-secondary">
          This will permanently delete the team <strong className="ad-text">{teamName}</strong> and remove all members. This action cannot be undone.
        </p>
        <p className="mt-4 text-sm ad-text-muted">
          Type the team name to confirm:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={teamName}
          className="mt-2 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:border-red-500 focus:outline-none"
          autoFocus
        />
        {error && (
          <p className="mt-2 text-sm ad-text-error">{error}</p>
        )}
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => {
              setShowConfirm(false);
              setConfirmText("");
              setError(null);
            }}
            className="rounded-lg px-4 py-2 text-sm ad-text-muted hover:ad-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={confirmText !== teamName || deleting}
            className="rounded-lg ad-bg-error px-4 py-2 text-sm font-medium ad-text-error transition-colors hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting..." : "Delete Team"}
          </button>
        </div>
      </div>
    </div>
  );
}
