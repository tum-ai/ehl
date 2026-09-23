import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Chapter } from "@/lib/types";
import type { TeamMatchHistoryEntry } from "@/lib/queries/teams";
import { formatDeadline } from "@/lib/utils";

type Application = { chapter_id: string; status: string };

const activePhases = new Set<Chapter["status"]>([
  "challenge_selection", "hacking", "submissions_open", "pitching",
]);

/** Presentation only: reuse the dashboard's existing applications and chapters. */
export function getCurrentHackathons(chapters: Chapter[], applications: Application[]) {
  const attending = new Map(applications
    .filter((app) => app.status === "accepted" || app.status === "checked_in")
    .map((app) => [app.chapter_id, app.status]));

  return chapters
    .filter((chapter) => activePhases.has(chapter.status) && attending.has(chapter.id))
    .sort((a, b) => Number(attending.get(b.id) === "checked_in")
      - Number(attending.get(a.id) === "checked_in") || a.matchNumber - b.matchNumber);
}

const phaseLabels: Partial<Record<Chapter["status"], string>> = {
  challenge_selection: "Challenge selection",
  hacking: "Hacking",
  submissions_open: "Submissions open",
  pitching: "Pitching",
};

export function CurrentHackathon({ chapter, participation, checkedIn, isPresident }: {
  chapter: Chapter;
  participation: TeamMatchHistoryEntry | undefined;
  checkedIn: boolean;
  isPresident: boolean;
}) {
  const matchHref = `/matches/${chapter.slug}`;
  const now = Date.now();
  const submissionPhase = chapter.status === "hacking" || chapter.status === "submissions_open";
  const deadlinePassed = !!chapter.submissionDeadline && Date.parse(chapter.submissionDeadline) <= now;
  const selectionClosed = !chapter.challengeRegistrationEnabled
    || (!!chapter.challengeSelectionDeadline && Date.parse(chapter.challengeSelectionDeadline) <= now);
  const registered = !!participation?.registration && !!participation.challenge;
  const canOpenSubmission = checkedIn && submissionPhase && !deadlinePassed && registered;

  let label = "Open hackathon";
  let href = matchHref;
  let message = "Open the hackathon for the latest event information.";

  if (!checkedIn) {
    message = "Check in at the event before selecting a challenge or submitting.";
  } else if (chapter.status === "challenge_selection") {
    if (selectionClosed) {
      message = "Challenge selection is currently closed. Open the hackathon for details.";
    } else {
      label = isPresident ? "Choose challenge" : "View challenges";
      message = isPresident
        ? "Select or review your team's challenge on the hackathon page."
        : "Your team president selects the challenge. You can browse the challenges.";
    }
  } else if (submissionPhase) {
    if (deadlinePassed) {
      message = "The submission deadline has passed.";
    } else if (!registered) {
      message = "Your team has not selected a challenge. Ask your president or the organizers for help.";
    } else {
      label = participation?.submission ? "Edit submission" : "Submit project";
      href = `${matchHref}#submission`;
      message = participation?.submission
        ? `Submitted: ${participation.submission.projectName}`
        : "Your team has not submitted yet.";
    }
  } else if (chapter.status === "pitching") {
    message = "Submissions are closed. Open the hackathon to see the pitch order.";
  }

  const deadline = chapter.status === "challenge_selection"
    ? chapter.challengeSelectionDeadline : submissionPhase ? chapter.submissionDeadline : null;

  return (
    <Card className="border-gold/30 bg-gold/5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="live">{phaseLabels[chapter.status] ?? chapter.status}</Badge>
        <span className="text-sm text-text-secondary">{chapter.city}</span>
      </div>
      <h3 className="mt-3 text-2xl font-bold break-words">{chapter.name}</h3>
      {participation?.challenge && (
        <p className="mt-2 text-sm text-text-secondary">Challenge: {participation.challenge.title}</p>
      )}
      {deadline && (
        <p className="mt-2 text-sm text-text-secondary">
          {chapter.status === "challenge_selection" ? "Challenge selection deadline" : "Submission deadline"}
          {": "}<time dateTime={deadline}>{formatDeadline(deadline)}</time>
        </p>
      )}
      <p className="mt-3 text-sm text-text-secondary" role="status">{message}</p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <Button href={href} className="w-full justify-center sm:w-auto">{label}</Button>
        {label !== "Open hackathon" && (
          <Link href={matchHref} className="text-center text-sm font-medium text-gold hover:underline sm:text-left">
            Open hackathon
          </Link>
        )}
        <Link href={`/event/${chapter.slug}`} className="text-center text-sm text-text-secondary hover:underline sm:text-left">
          Event information
        </Link>
      </div>
      {canOpenSubmission && (
        <p className="mt-3 text-xs text-text-secondary">Any team member can submit for the team.</p>
      )}
    </Card>
  );
}
