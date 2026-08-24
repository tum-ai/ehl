"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminRemoveMember } from "@/lib/actions/admin";
import { describeRemoval } from "./removal-consequence";

interface RemoveMemberButtonProps {
  teamId: string;
  userId: string;
  memberName: string;
  teamName: string;
  /** Roster size BEFORE the removal. */
  rosterSize: number;
  isCaptain: boolean;
  /** Who inherits the captaincy if this member is the captain and not the last. */
  successorName: string | null;
}

export function RemoveMemberButton({
  teamId,
  userId,
  memberName,
  teamName,
  rosterSize,
  isCaptain,
  successorName,
}: RemoveMemberButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const router = useRouter();

  const consequence = describeRemoval({
    memberName,
    teamName,
    rosterSize,
    isCaptain,
    successorName,
  });

  async function handleRemove() {
    setRemoving(true);
    const result = await adminRemoveMember(teamId, userId);
    if (result.error) {
      alert(result.error);
      setRemoving(false);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (confirming) {
    return (
      // Anchored popover with its own width. Rendered inline it was squeezed by
      // the narrow Members column and wrapped every two or three words, which
      // made the consequence text (the whole point of the step) hard to read.
      <span className="relative inline-block align-middle">
        <span className="absolute left-0 top-0 z-20 flex w-64 flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 shadow-lg">
          {consequence.lines.map((line, i) => (
            <span
              key={line}
              className={
                i === 0 ? "text-xs font-semibold ad-text" : "text-xs ad-text-secondary"
              }
            >
              {line}
            </span>
          ))}
          <span className="mt-1 inline-flex items-center gap-3">
            <button
              onClick={handleRemove}
              disabled={removing}
              className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {removing ? "Removing..." : "Confirm remove"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={removing}
              className="text-xs ad-text-muted hover:ad-text-secondary"
            >
              Cancel
            </button>
          </span>
        </span>
      </span>
    );
  }

  // A labelled control, not a bare glyph. This used to render as a 10px muted
  // "x" with no text: the action existed but was effectively undiscoverable, so
  // operators reached for "move to another team" instead, which is how a
  // no-show ended up being fixed by hand in the database.
  return (
    <button
      onClick={() => setConfirming(true)}
      data-testid="remove-member"
      className="rounded border border-red-200 px-1.5 py-0.5 text-xs font-medium text-red-700 transition-colors hover:border-red-400 hover:bg-red-50"
      title={`Remove ${memberName} from ${teamName}`}
    >
      Remove
    </button>
  );
}
