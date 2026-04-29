"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createEventTeam,
  requestJoinTeam,
  searchTeamsAction,
} from "@/lib/actions/event";

interface PendingRequest {
  id: string;
  teamId: string;
  teamName: string;
  status: string;
}

interface TeamSelectorProps {
  chapterId: string;
  userId: string;
  pendingRequests: PendingRequest[];
  onTeamSelected: () => void;
}

type Tab = "create" | "join";

export function TeamSelector({
  chapterId,
  userId,
  pendingRequests,
  onTeamSelected,
}: TeamSelectorProps) {
  const [tab, setTab] = useState<Tab>("create");
  const [teamName, setTeamName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleCreateTeam() {
    if (!teamName.trim()) return;
    setActing(true);
    setError(null);

    const result = await createEventTeam(chapterId, teamName.trim());
    if (result.error) {
      setError(result.error);
    } else {
      onTeamSelected();
    }
    setActing(false);
  }

  async function handleSearch() {
    if (!searchQuery.trim() || searchQuery.length < 2) return;
    setSearching(true);
    const results = await searchTeamsAction(searchQuery);
    setSearchResults(results);
    setSearching(false);
  }

  async function handleRequestJoin(teamId: string) {
    setActing(true);
    setError(null);

    const result = await requestJoinTeam(chapterId, teamId);
    if (result.error) {
      setError(result.error);
    } else {
      setMessage("Join request sent. The team president needs to approve it.");
      onTeamSelected();
    }
    setActing(false);
  }

  return (
    <div>
      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <div className="mb-4 rounded-lg border border-purple/20 bg-purple/5 p-4">
          <p className="text-sm font-medium text-purple-light mb-2">Pending Join Requests</p>
          {pendingRequests.map((req) => (
            <div key={req.id} className="flex items-center gap-2 text-sm">
              <span className="text-text-secondary">Waiting for approval from</span>
              <span className="font-bold text-gold">{req.teamName}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex rounded-lg border border-white/10 p-0.5 mb-4">
        <button
          type="button"
          onClick={() => setTab("create")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            tab === "create"
              ? "bg-gold/10 text-gold"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          Create New Team
        </button>
        <button
          type="button"
          onClick={() => setTab("join")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            tab === "join"
              ? "bg-gold/10 text-gold"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          Join Existing Team
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-error/20 bg-error/5 p-3">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {message && (
        <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
          <p className="text-sm text-green-400">{message}</p>
        </div>
      )}

      {/* Create team */}
      {tab === "create" && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-text-muted mb-1">Team Name</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Enter your team name"
              className="w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
            />
          </div>
          <Button onClick={handleCreateTeam} disabled={acting || !teamName.trim()}>
            {acting ? "Creating..." : "Create Team"}
          </Button>
          <p className="text-xs text-text-muted">
            You will be the team president. Other participants can request to join your team.
          </p>
        </div>
      )}

      {/* Join team */}
      {tab === "join" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search team by name..."
              className="flex-1 rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
            />
            <Button onClick={handleSearch} disabled={searching || searchQuery.length < 2} variant="secondary">
              {searching ? "..." : "Search"}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((team) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 p-3"
                >
                  <span className="font-medium">{team.name}</span>
                  <Button
                    size="sm"
                    onClick={() => handleRequestJoin(team.id)}
                    disabled={acting}
                  >
                    Request to Join
                  </Button>
                </div>
              ))}
            </div>
          )}

          {searchResults.length === 0 && searchQuery.length >= 2 && !searching && (
            <p className="text-sm text-text-muted">No teams found.</p>
          )}

          <p className="text-xs text-text-muted">
            The team president must approve your request before you can join.
          </p>
        </div>
      )}
    </div>
  );
}
