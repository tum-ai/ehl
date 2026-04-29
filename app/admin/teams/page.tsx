import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getTeams, getAllTeamMembers } from "@/lib/queries";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { LimitBanner } from "@/components/admin/limit-banner";
import { DeleteTeamButton } from "./delete-team-button";
import { RemoveMemberButton } from "./remove-member-button";

export default async function AdminTeamsPage() {
  const [teams, allMembers] = await Promise.all([
    getTeams(),
    getAllTeamMembers(),
  ]);

  // Group members by team
  const membersByTeam = new Map<string, typeof allMembers>();
  for (const member of allMembers) {
    const existing = membersByTeam.get(member.teamId) ?? [];
    existing.push(member);
    membersByTeam.set(member.teamId, existing);
  }

  return (
    <div>
      <h1 className="ad-title text-2xl">Teams</h1>
      <p className="mt-1 ad-text-secondary">
        {teams.length} registered teams
      </p>

      <div className="mt-4 space-y-2">
        <LimitBanner count={teams.length} limit={QUERY_LIMITS.teams} label="teams" />
        <LimitBanner count={allMembers.length} limit={QUERY_LIMITS.allTeamMembers} label="team members" />
      </div>

      <div className="mt-8 overflow-x-auto rounded-2xl ad-border ad-bg-card ui-card-subtle">
        <table className="w-full">
          <thead>
            <tr className="border-b ad-border text-left text-xs font-bold uppercase tracking-wider ad-text-muted">
              <th className="px-6 py-4">Team</th>
              <th className="px-6 py-4">Members</th>
              <th className="px-6 py-4">University</th>
              <th className="px-6 py-4">City</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const members = membersByTeam.get(team.id) ?? [];
              return (
                <tr
                  key={team.id}
                  className="border-b ad-border ad-bg-card-hover transition-colors"
                >
                  <td className="px-6 py-4">
                    <Link
                      href={`/team/${team.slug}`}
                      className="font-semibold ad-text hover:text-purple-700 transition-colors"
                    >
                      {team.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    {members.length > 0 ? (
                      <div className="space-y-0.5">
                        {members.map((m) => (
                          <p key={m.userId} className="flex items-center gap-1.5 text-sm ad-text-secondary">
                            <span>
                              {m.profile?.name || m.profile?.email || m.userId.slice(0, 8)}
                            </span>
                            {m.role === "president" ? (
                              <span className="text-[10px] font-bold uppercase ad-text-gold">
                                Capt
                              </span>
                            ) : (
                              <RemoveMemberButton
                                teamId={team.id}
                                userId={m.userId}
                                memberName={m.profile?.name || m.profile?.email || "member"}
                              />
                            )}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm ad-text-muted">No members</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm ad-text-muted">
                    {team.university || "-"}
                  </td>
                  <td className="px-6 py-4 text-sm ad-text-muted">
                    {team.city || "-"}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Badge variant="completed" light>Active</Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/team/${team.slug}`}
                        className="text-sm font-medium ad-text-link transition-colors"
                      >
                        View
                      </Link>
                      <DeleteTeamButton teamId={team.id} teamName={team.name} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
