import {
  getChaptersAdmin,
  getChallengesForChapter,
  getChapterRegistrationsByTeam,
} from "@/lib/queries";
import {
  getTeamsPaged,
  getAllTeamMembersPaged,
  getAllParticipantsWithTeamsPaged,
} from "@/lib/queries/teams";
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

  // Paged reads: a plain .limit() cannot exceed PostgREST's server-side
  // max_rows (1000), which is what capped this page at exactly 1000
  // participants with no banner to say so. Each read also reports whether more
  // rows exist, which is the only honest input to a LimitBanner.
  const [teamsPage, membersPage, participantsPage] = await Promise.all([
    getTeamsPaged(),
    getAllTeamMembersPaged(),
    getAllParticipantsWithTeamsPaged(activeChapter?.id),
  ]);
  const teams = teamsPage.rows;
  const allMembers = membersPage.rows;
  const participants = participantsPage.rows;

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
      teamsTruncated={teamsPage.truncated}
      membersTruncated={membersPage.truncated}
      participantsTruncated={participantsPage.truncated}
    />
  );
}
