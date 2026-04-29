"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { unlockTeams, revokeUnlock } from "@/lib/actions/admin";

interface Team {
  id: string;
  name: string;
  university: string | null;
  city: string | null;
}

interface Unlock {
  teamId: string;
  unlockedAt: string;
}

export default function AdminUnlocksPage({ params }: { params: Promise<{ id: string }> }) {
  const [chapterId, setChapterId] = useState<string>("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [unlocks, setUnlocks] = useState<Unlock[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    params.then(async ({ id }) => {
      setChapterId(id);
      // Fetch data client-side
      const [teamsRes, unlocksRes] = await Promise.all([
        fetch(`/api/admin/teams`).then((r) => r.json()).catch(() => []),
        fetch(`/api/admin/chapters/${id}/unlocks`).then((r) => r.json()).catch(() => []),
      ]);
      setTeams(teamsRes);
      setUnlocks(unlocksRes);
      setLoading(false);
    });
  }, [params]);

  const unlockedIds = new Set(unlocks.map((u) => u.teamId));

  async function handleUnlock() {
    if (selected.size === 0) return;
    setSaving(true);
    const result = await unlockTeams(chapterId, Array.from(selected));
    if (!result.error) {
      // Add to unlocks
      setUnlocks((prev) => [
        ...prev,
        ...Array.from(selected).map((id) => ({ teamId: id, unlockedAt: new Date().toISOString() })),
      ]);
      setSelected(new Set());
    }
    setSaving(false);
  }

  async function handleRevoke(teamId: string) {
    setSaving(true);
    const result = await revokeUnlock(chapterId, teamId);
    if (!result.error) {
      setUnlocks((prev) => prev.filter((u) => u.teamId !== teamId));
    }
    setSaving(false);
  }

  function toggleAll() {
    const notUnlocked = teams.filter((t) => !unlockedIds.has(t.id));
    if (selected.size === notUnlocked.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(notUnlocked.map((t) => t.id)));
    }
  }

  if (loading) {
    return (
      <div>
        <p className="ad-text-muted">Loading teams...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to Chapter
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Team Unlocks</h1>
          <p className="mt-1 ad-text-secondary">
            {unlocks.length} of {teams.length} teams unlocked
          </p>
        </div>
        {selected.size > 0 && (
          <Button onClick={handleUnlock} disabled={saving}>
            {saving ? "Unlocking..." : `Unlock ${selected.size} Team${selected.size > 1 ? "s" : ""}`}
          </Button>
        )}
      </div>

      {/* Unlocked teams */}
      {unlocks.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider ad-text-muted">
            Unlocked ({unlocks.length})
          </h2>
          <div className="space-y-2">
            {unlocks.map((unlock) => {
              const team = teams.find((t) => t.id === unlock.teamId);
              if (!team) return null;
              return (
                <div
                  key={unlock.teamId}
                  className="flex items-center justify-between rounded-lg border ad-border-warning ad-bg-warning px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{team.name}</p>
                    <p className="text-xs ad-text-muted">
                      {team.university || team.city || "No origin"}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(unlock.teamId)}
                    disabled={saving}
                    className="text-xs ad-text-error hover:underline"
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available teams */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider ad-text-muted">
            Available Teams ({teams.filter((t) => !unlockedIds.has(t.id)).length})
          </h2>
          <button
            onClick={toggleAll}
            className="text-xs ad-text-link transition-colors"
          >
            {selected.size === teams.filter((t) => !unlockedIds.has(t.id)).length
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>
        <div className="space-y-2">
          {teams
            .filter((t) => !unlockedIds.has(t.id))
            .map((team) => (
              <label
                key={team.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border ad-border px-4 py-3 transition-colors ad-bg-card-hover"
              >
                <input
                  type="checkbox"
                  checked={selected.has(team.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(team.id)) {
                      next.delete(team.id);
                    } else {
                      next.add(team.id);
                    }
                    setSelected(next);
                  }}
                  className="h-4 w-4 rounded accent-purple-700"
                />
                <div>
                  <p className="font-medium">{team.name}</p>
                  <p className="text-xs ad-text-muted">
                    {team.university || team.city || "No origin"}
                  </p>
                </div>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}
