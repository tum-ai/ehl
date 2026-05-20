"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { inviteMember, cancelInvite, toggleLookingForMembers, resolveDashboardJoinRequest, leaveTeam } from "@/lib/actions/teams";
import type { TeamMember, Profile, TeamInvite, Team, TeamJoinRequest } from "@/lib/types";

interface TeamManagementProps {
  team: Team;
  members: (TeamMember & { profile?: Profile })[];
  pendingInvites: TeamInvite[];
  joinRequests: TeamJoinRequest[];
  lookingForTeamUsers: { id: string; name: string | null; email: string | null }[];
  currentUserId: string;
}

export function TeamManagement({
  team,
  members,
  pendingInvites: initialInvites,
  joinRequests: initialJoinRequests,
  lookingForTeamUsers: initialLookingUsers,
  currentUserId,
}: TeamManagementProps) {
  const router = useRouter();
  const [invites, setInvites] = useState(initialInvites);
  const [joinRequests, setJoinRequests] = useState(initialJoinRequests);
  const [lookingUsers] = useState(initialLookingUsers);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lookingForMembers, setLookingForMembers] = useState(team.lookingForMembers);
  const [leaving, setLeaving] = useState(false);

  const isFull = members.length >= 5;
  const isPresident = members.some((m) => m.userId === currentUserId && m.role === "president");

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await inviteMember(team.id, inviteEmail, inviteName || undefined);

    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setInviteEmail("");
      setInviteName("");
      setShowInviteForm(false);
      setInvites((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          teamId: team.id,
          email: inviteEmail.toLowerCase(),
          name: inviteName || null,
          invitedBy: "",
          status: "pending" as const,
          token: "",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
        },
      ]);
    }
  }

  async function handleCancel(inviteId: string) {
    const result = await cancelInvite(inviteId);
    if (!result.error) {
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    }
  }

  async function handleToggleLooking() {
    const newValue = !lookingForMembers;
    const result = await toggleLookingForMembers(team.id, newValue);
    if (!result.error) {
      setLookingForMembers(newValue);
    }
  }

  async function handleResolveRequest(requestId: string, approved: boolean) {
    setActionLoading(requestId);
    const result = await resolveDashboardJoinRequest(requestId, approved);
    setActionLoading(null);
    if (result.error) {
      alert(result.error);
    } else {
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (approved) {
        router.refresh();
      }
    }
  }

  async function handleInviteUser(userEmail: string, userName: string | null) {
    setActionLoading(userEmail);
    const result = await inviteMember(team.id, userEmail, userName || undefined);
    setActionLoading(null);
    if (result.error) {
      alert(result.error);
    } else {
      setInvites((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          teamId: team.id,
          email: userEmail.toLowerCase(),
          name: userName || null,
          invitedBy: "",
          status: "pending" as const,
          token: "",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
        },
      ]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Team Roster */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
            Team Roster ({members.length}/5)
          </h2>
          {!isFull && (
            <button
              onClick={() => setShowInviteForm(!showInviteForm)}
              className="text-sm text-gold hover:underline"
            >
              {showInviteForm ? "Cancel" : "+ Invite Member"}
            </button>
          )}
        </div>

        {/* Members list */}
        <div className="mt-4 space-y-2">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between rounded-lg border border-white/5 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {m.profile?.name || m.profile?.email || "Unknown"}
                  {m.userId === currentUserId && <span className="ml-1.5 text-gold">*</span>}
                </p>
                <p className="text-xs text-text-muted">{m.profile?.email}</p>
              </div>
              <Badge variant={m.role === "president" ? "completed" : "upcoming"}>
                {m.role === "president" ? "President" : "Member"}
              </Badge>
            </div>
          ))}

          {/* Pending invites */}
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded-lg border border-white/5 border-dashed px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text-secondary">
                  {inv.name || inv.email}
                </p>
                <p className="text-xs text-text-muted">{inv.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="announced">Pending</Badge>
                <button
                  onClick={() => handleCancel(inv.id)}
                  className="text-xs text-text-muted hover:text-error"
                  title="Cancel invite"
                >
                  &times;
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Invite form */}
        {showInviteForm && (
          <form onSubmit={handleInvite} className="mt-4 rounded-lg border border-white/10 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-text-muted">Name</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Member name"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted">Email *</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                  required
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                />
              </div>
            </div>
            {error && (
              <p className="mt-2 text-xs text-error">{error}</p>
            )}
            <div className="mt-3 flex justify-end">
              <Button type="submit" disabled={loading || !inviteEmail}>
                {loading ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </form>
        )}

        {/* Looking for members toggle */}
        {!isFull && (
          <div className="mt-4 border-t border-white/5 pt-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={lookingForMembers}
                onChange={handleToggleLooking}
                className="h-4 w-4 rounded border-white/20 bg-surface-deep"
              />
              <div>
                <p className="text-sm font-medium">Looking for members</p>
                <p className="text-xs text-text-muted">
                  Participants without a team can see your team and request to join
                </p>
              </div>
            </label>
          </div>
        )}

        {!isPresident && (
          <div className="mt-4 border-t border-white/5 pt-4">
            <button
              onClick={async () => {
                if (!confirm("Are you sure you want to leave this team?")) return;
                setLeaving(true);
                const result = await leaveTeam();
                if (result.error) {
                  alert(result.error);
                  setLeaving(false);
                } else {
                  window.location.reload();
                }
              }}
              disabled={leaving}
              className="text-sm text-error hover:text-error/80 transition-colors"
            >
              {leaving ? "Leaving..." : "Leave Team"}
            </button>
          </div>
        )}
      </Card>

      {/* Join Requests */}
      {joinRequests.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
            Join Requests
          </h2>
          <div className="space-y-2">
            {joinRequests.map((req) => (
              <Card key={req.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {req.userName || req.userEmail || "Unknown"}
                    </p>
                    <p className="text-xs text-text-muted">{req.userEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleResolveRequest(req.id, false)}
                      disabled={actionLoading === req.id}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleResolveRequest(req.id, true)}
                      disabled={actionLoading === req.id || isFull}
                    >
                      {actionLoading === req.id ? "..." : "Accept"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Participants looking for a team (captain can invite them) */}
      {!isFull && lookingUsers.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-text-muted">
            Participants Looking for a Team
          </h2>
          <div className="space-y-2">
            {lookingUsers.map((u) => {
              const alreadyInvited = invites.some(
                (inv) => inv.email.toLowerCase() === u.email?.toLowerCase()
              );
              return (
                <Card key={u.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{u.name || u.email || "Unknown"}</p>
                      <p className="text-xs text-text-muted">{u.email}</p>
                    </div>
                    {alreadyInvited ? (
                      <Badge variant="announced">Invited</Badge>
                    ) : (
                      <button
                        onClick={() => handleInviteUser(u.email!, u.name)}
                        disabled={actionLoading === u.email || !u.email}
                        className="rounded-lg border border-purple/30 bg-purple/5 px-3 py-1.5 text-xs font-medium text-purple-light transition-colors hover:bg-purple/10 disabled:opacity-50"
                      >
                        {actionLoading === u.email ? "Sending..." : "Invite"}
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
