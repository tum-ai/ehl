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
      <span className="inline-flex flex-col gap-1 rounded-md border ad-border bg-amber-50 px-2 py-1.5">
        {consequence.lines.map((line, i) => (
          <span
            key={line}
            className={
              i === 0
                ? "text-[11px] font-semibold ad-text"
                : "text-[11px] ad-text-secondary"
            }
          >
            {line}
          </span>
        ))}
        <span className="mt-0.5 inline-flex items-center gap-2">
          <button
            onClick={handleRemove}
            disabled={removing}
            className="text-[10px] font-bold ad-text-error hover:text-red-700 disabled:opacity-50"
          >
            {removing ? "Removing..." : "Confirm remove"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={removing}
            className="text-[10px] ad-text-muted hover:ad-text-secondary"
          >
            Cancel
          </button>
        </span>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-[10px] ad-text-muted hover:text-red-700 transition-colors"
      title={`Remove ${memberName} from ${teamName}`}
    >
      &times;
    </button>
  );
}
