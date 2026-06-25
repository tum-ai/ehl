import {
  getTeams,
  getAllTeamMembers,
  getChaptersAdmin,
  getChallengesForChapter,
  getChapterRegistrationsByTeam,
} from "@/lib/queries";
import { getAllParticipantsWithTeams } from "@/lib/queries/teams";
import { TeamsAndParticipantsView } from "./teams-participants-view";
import { requireGlobalAdminPage } from "@/lib/admin-auth";

// Statuses during which an admin may still override a team's challenge. Mirrors
// CHALLENGE_OVERRIDE_OPEN_STATUSES in lib/actions/admin.ts (the server-side gate
// is authoritative; this only decides whether the UI control is offered).
const CHALLENGE_OVERRIDE_OPEN_STATUSES = new Set([
  "challenge_selection",
  "hacking",
  "submissions_open",
]);

export default async function AdminTeamsPage() {
  await requireGlobalAdminPage();
  const chapters = await getChaptersAdmin();

  // Find the active event chapter (hacking/submissions_open/pitching/preparation/challenge_selection)
  const eventStatuses = new Set(["preparation", "challenge_selection", "hacking", "submissions_open", "pitching"]);
  const activeChapter = chapters.find((c) => eventStatuses.has(c.status)) ?? null;

  const [teams, allMembers, participants] = await Promise.all([
    getTeams(),
    getAllTeamMembers(),
    getAllParticipantsWithTeams(activeChapter?.id),
  ]);

  // Challenge-override data: only load when the active chapter still allows it
  // and its submission deadline (if any) has not passed.
  const overrideOpen =
    !!activeChapter &&
    CHALLENGE_OVERRIDE_OPEN_STATUSES.has(activeChapter.status) &&
    (!activeChapter.submissionDeadline ||
      new Date(activeChapter.submissionDeadline) > new Date());

  const [challenges, registrationsByTeamEntries] =
    overrideOpen && activeChapter
      ? await Promise.all([
          getChallengesForChapter(activeChapter.id),
          getChapterRegistrationsByTeam(activeChapter.id).then((m) => [...m.entries()]),
        ])
      : [[], [] as [string, string][]];

  return (
    <TeamsAndParticipantsView
      teams={teams}
      allMembers={allMembers}
      participants={participants}
      activeChapter={activeChapter}
      challengeOverrideOpen={overrideOpen}
      challenges={challenges.map((c) => ({ id: c.id, title: c.title }))}
      registrationsByTeam={registrationsByTeamEntries}
    />
  );
}
