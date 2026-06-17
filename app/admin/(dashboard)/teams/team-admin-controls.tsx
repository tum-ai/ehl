"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminChangeCaptain,
  adminAddMemberByEmail,
  adminMoveMember,
} from "@/lib/actions/admin";

interface Member {
  userId: string;
  role: string;
  name: string;
}

interface TeamOption {
  id: string;
  name: string;
}

/**
 * Admin override panel for a single team: change captain, add a member by email,
 * and move a member to another team. All actions are server-side, admin-guarded,
 * and audit-logged. Team-size limits are enforced by the actions.
 */
export function TeamAdminControls({
  teamId,
  members,
  allTeams,
}: {
  teamId: string;
  members: Member[];
  allTeams: TeamOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addEmail, setAddEmail] = useState("");

  async function run(fn: () => Promise<{ error?: string; success?: boolean }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      alert(res.error);
    } else {
      router.refresh();
    }
  }

  const captain = members.find((m) => m.role === "president");
  const nonCaptains = members.filter((m) => m.role !== "president");
  const otherTeams = allTeams.filter((t) => t.id !== teamId);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium ad-text-link transition-colors"
      >
        Manage
      </button>
    );
  }

  return (
    <div className="ad-border ad-bg-card mt-2 rounded-lg border p-3 text-left text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold ad-text">Admin overrides</span>
        <button onClick={() => setOpen(false)} className="ad-text-muted">
          close
        </button>
      </div>

      {/* Change captain */}
      <div className="mb-3">
        <label className="ad-text-muted block">Captain</label>
        <select
          disabled={busy}
          defaultValue={captain?.userId ?? ""}
          onChange={(e) => {
            const uid = e.target.value;
            if (!uid || uid === captain?.userId) return;
            const name = members.find((m) => m.userId === uid)?.name ?? "this member";
            if (!confirm(`Make ${name} the team captain? This transfers president powers.`)) {
              // revert the visible selection
              e.target.value = captain?.userId ?? "";
              return;
            }
            run(() => adminChangeCaptain(teamId, uid));
          }}
          className="ad-border ad-bg-input ad-text mt-1 w-full rounded border px-2 py-1"
        >
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
              {m.role === "president" ? " (captain)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Add member by email */}
      <div className="mb-3">
        <label className="ad-text-muted block">Add member by email</label>
        <div className="mt-1 flex gap-1">
          <input
            type="email"
            value={addEmail}
            disabled={busy}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="user@example.com"
            className="ad-border ad-bg-input ad-text flex-1 rounded border px-2 py-1"
          />
          <button
            disabled={busy || !addEmail.trim()}
            onClick={() =>
              run(async () => {
                const r = await adminAddMemberByEmail(teamId, addEmail);
                if (!r.error) setAddEmail("");
                return r;
              })
            }
            className="rounded bg-gold px-2 py-1 font-medium text-surface-deep disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Move a member to another team */}
      {nonCaptains.length > 0 && otherTeams.length > 0 && (
        <div>
          <label className="ad-text-muted block">Move member to team</label>
          {nonCaptains.map((m) => (
            <div key={m.userId} className="mt-1 flex items-center gap-1">
              <span className="ad-text-secondary flex-1 truncate">{m.name}</span>
              <select
                disabled={busy}
                defaultValue=""
                onChange={(e) => {
                  const toTeam = e.target.value;
                  if (toTeam) run(() => adminMoveMember(m.userId, teamId, toTeam));
                }}
                className="ad-border ad-bg-input ad-text rounded border px-1 py-1"
              >
                <option value="">move to…</option>
                {otherTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
