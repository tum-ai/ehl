import { getTeams, getAllTeamMembers, getChaptersAdmin } from "@/lib/queries";
import { getAllParticipantsWithTeams } from "@/lib/queries/teams";
import { TeamsAndParticipantsView } from "./teams-participants-view";

export default async function AdminTeamsPage() {
  const chapters = await getChaptersAdmin();

  // Find the active event chapter (hacking/submissions_open/pitching/preparation/challenge_selection)
  const eventStatuses = new Set(["preparation", "challenge_selection", "hacking", "submissions_open", "pitching"]);
  const activeChapter = chapters.find((c) => eventStatuses.has(c.status)) ?? null;

  const [teams, allMembers, participants] = await Promise.all([
    getTeams(),
    getAllTeamMembers(),
    getAllParticipantsWithTeams(activeChapter?.id),
  ]);

  return (
    <TeamsAndParticipantsView
      teams={teams}
      allMembers={allMembers}
      participants={participants}
      activeChapter={activeChapter}
    />
  );
}
