import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getTeamBySlug,
  getTeamMembers,
  getLeaderboard,
  getScores,
  getChapters,
  getProfile,
} from "@/lib/queries";
import { cn, getPlacementLabel } from "@/lib/utils";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return { title: "Team Not Found" };
  return {
    title: team.name,
    description: `${team.name} team profile in the European Hackathon League`,
  };
}

const placementColors: Record<number, string> = {
  1: "text-gold",
  2: "text-silver",
  3: "text-bronze",
};

export default async function TeamProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);

  if (!team) {
    notFound();
  }

  const [members, leaderboard, allScores, chapters] = await Promise.all([
    getTeamMembers(team.id),
    getLeaderboard(),
    getScores(),
    getChapters(),
  ]);

  const entry = leaderboard.find((e) => e.team.id === team.id);
  const teamScores = allScores.filter((s) => s.teamId === team.id);

  // Load member profiles
  const memberProfiles = await Promise.all(
    members.map(async (m) => {
      const profile = await getProfile(m.userId);
      return { ...m, profile };
    })
  );

  return (
    <Section className="relative overflow-hidden">
      <div className="noise absolute inset-0" />
      <div className="glow-blob glow-blob-gold absolute -right-40 -top-20 h-[400px] w-[400px] opacity-10" />

      {/* Team header */}
      <div className="relative mb-12">
        <div className="flex items-center gap-4">
          {team.logoUrl ? (
            <img
              src={team.logoUrl}
              alt={team.name}
              className="h-16 w-16 rounded-2xl object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-card border border-white/[0.06]">
              <span className="text-2xl font-black text-gold">
                {team.name.charAt(0)}
              </span>
            </div>
          )}
          <div>
            <h1 className="font-hero-display text-3xl font-black sm:text-4xl">{team.name}</h1>
            <p className="mt-1 text-text-secondary">
              {[team.university, team.city].filter(Boolean).join(", ") || "European Hackathon League"}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="relative mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Rank</p>
          <p className="mt-1 text-3xl font-mono font-black text-gold">
            {entry ? `#${entry.rank}` : "-"}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Points</p>
          <p className="mt-1 text-3xl font-mono font-black text-gold">
            {entry?.totalPoints ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Matches</p>
          <p className="mt-1 text-3xl font-mono font-black text-gold">
            {entry?.matchesPlayed ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Best Finish</p>
          <p className="mt-1 text-3xl font-mono font-black text-gold">
            {entry?.bestFinish ? getPlacementLabel(entry.bestFinish) : "-"}
          </p>
        </Card>
      </div>

      {/* Match history */}
      {teamScores.length > 0 && (
        <div className="relative mb-8">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-text-muted">
            Match History
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-surface-card/40">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  <th className="px-6 py-4">Match</th>
                  <th className="px-6 py-4">Challenge</th>
                  <th className="px-6 py-4 text-center">Placement</th>
                  <th className="px-6 py-4 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {teamScores.map((score) => {
                  const chapter = chapters.find((c) => c.id === score.chapterId);
                  return (
                    <tr
                      key={score.chapterId}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-6 py-4 font-medium">
                        {chapter?.name || "Unknown"}
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {score.challengeName}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={cn(
                          "font-mono font-bold",
                          score.placement ? placementColors[score.placement] || "text-text-secondary" : "text-text-muted"
                        )}>
                          {score.placement ? getPlacementLabel(score.placement) : "Participated"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-mono font-bold text-gold">+{score.points}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Roster */}
      {memberProfiles.length > 0 && (
        <div className="relative">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-text-muted">
            Roster
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {memberProfiles.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-surface-card/40 px-4 py-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple/10 text-sm font-bold text-purple">
                  {(member.profile?.name || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium">{member.profile?.name || "Unknown"}</p>
                  <p className="text-xs text-text-muted">
                    {member.role === "president" ? "President" : "Member"}
                  </p>
                </div>
                {member.role === "president" && (
                  <Badge variant="announced" className="ml-auto">President</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
