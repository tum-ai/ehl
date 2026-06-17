"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminChangeUserEmail } from "@/lib/actions/admin";

/**
 * Admin override: change a participant's email. Updates both the Supabase auth
 * user and the profile (server-side, audit-logged) so login keeps working.
 */
export function ChangeEmailButton({
  userId,
  currentEmail,
}: {
  userId: string;
  currentEmail: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentEmail);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-[10px] ad-text-muted hover:ad-text-link transition-colors"
        title="Change email"
      >
        edit
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="email"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        className="ad-border ad-bg-input ad-text w-48 rounded border px-1 py-0.5 text-xs"
      />
      <button
        disabled={busy || !value.trim() || value === currentEmail}
        onClick={async () => {
          if (
            !confirm(
              `Change email from ${currentEmail} to ${value}? This updates their login.`
            )
          )
            return;
          setBusy(true);
          const res = await adminChangeUserEmail(userId, value);
          setBusy(false);
          if (res.error) {
            alert(res.error);
          } else {
            setEditing(false);
            router.refresh();
          }
        }}
        className="rounded bg-gold px-1.5 py-0.5 text-[10px] font-bold text-surface-deep disabled:opacity-50"
      >
        {busy ? "…" : "Save"}
      </button>
      <button
        onClick={() => {
          setValue(currentEmail);
          setEditing(false);
        }}
        className="text-[10px] ad-text-muted"
      >
        cancel
      </button>
    </span>
  );
}
