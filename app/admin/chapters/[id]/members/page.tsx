"use client";

import { useState, useEffect, useCallback, use } from "react";
import { Button } from "@/components/ui/button";
import { adminRemoveMember } from "@/lib/actions/admin";
import { useRouter } from "next/navigation";

interface MemberInfo {
  teamId: string;
  teamName: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  checkedIn: boolean;
}

export default function AdminChapterMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: chapterId } = use(params);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/admin/chapters/${chapterId}/members`);
    if (res.ok) {
      setMembers(await res.json());
    }
    setLoading(false);
  }, [chapterId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRemove(teamId: string, userId: string, name: string) {
    if (!confirm(`Remove ${name} from their team? This cannot be undone.`)) return;
    setRemoving(userId);
    setError(null);
    const result = await adminRemoveMember(teamId, userId);
    if (result.error) {
      setError(result.error);
    } else {
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    }
    setRemoving(null);
  }

  // Group by team
  const teamMap = new Map<string, { name: string; members: MemberInfo[] }>();
  for (const m of members) {
    if (!teamMap.has(m.teamId)) {
      teamMap.set(m.teamId, { name: m.teamName, members: [] });
    }
    teamMap.get(m.teamId)!.members.push(m);
  }

  const checkedInCount = members.filter((m) => m.checkedIn).length;

  if (loading) return <p className="ad-text-secondary">Loading...</p>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Chapter Members</h1>
          <p className="mt-1 ad-text-secondary">
            {teamMap.size} teams, {members.length} members ({checkedInCount} checked in)
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg ad-bg-error ad-border-error border p-3 text-sm ad-text-error">
          {error}
        </div>
      )}

      <div className="mt-8 space-y-6">
        {Array.from(teamMap.entries()).map(([teamId, team]) => {
          const allIn = team.members.every((m) => m.checkedIn);
          return (
            <div
              key={teamId}
              className={`rounded-2xl border p-5 ${allIn ? "ad-border border-green-200" : "ad-border"} ad-bg-card`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold ad-text">{team.name}</h3>
                <span
                  className={`text-xs font-bold rounded-full px-2.5 py-0.5 ${
                    allIn
                      ? "bg-green-100 text-green-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {allIn ? "All Checked In" : `${team.members.filter((m) => m.checkedIn).length}/${team.members.length} Checked In`}
                </span>
              </div>
              <div className="space-y-1.5">
                {team.members.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      {m.checkedIn ? (
                        <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className="ad-text">{m.name || m.email}</span>
                      {m.role === "president" && (
                        <span className="text-[10px] font-bold uppercase ad-text-gold">Capt</span>
                      )}
                    </div>
                    {m.role !== "president" && (
                      <button
                        onClick={() => handleRemove(m.teamId, m.userId, m.name || m.email)}
                        disabled={removing === m.userId}
                        className="text-xs ad-text-error hover:text-red-700 transition-colors disabled:opacity-30"
                      >
                        {removing === m.userId ? "..." : "Remove"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {teamMap.size === 0 && (
          <p className="ad-text-muted text-center py-8">No teams registered for this chapter yet.</p>
        )}
      </div>
    </div>
  );
}
