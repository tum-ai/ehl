"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminRemoveMember } from "@/lib/actions/admin";

interface RemoveMemberButtonProps {
  teamId: string;
  userId: string;
  memberName: string;
}

export function RemoveMemberButton({ teamId, userId, memberName }: RemoveMemberButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const router = useRouter();

  async function handleRemove() {
    setRemoving(true);
    const result = await adminRemoveMember(teamId, userId);
    if (result.error) {
      alert(result.error);
      setRemoving(false);
    } else {
      setConfirming(false);
      router.refresh();
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          onClick={handleRemove}
          disabled={removing}
          className="text-[10px] font-bold ad-text-error hover:text-red-700"
        >
          {removing ? "..." : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] ad-text-muted hover:ad-text-secondary"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-[10px] ad-text-muted hover:text-red-700 transition-colors"
      title={`Remove ${memberName} from team`}
    >
      &times;
    </button>
  );
}
