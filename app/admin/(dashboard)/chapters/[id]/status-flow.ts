import type { ChapterStatus } from "@/lib/types";

// Must list every ChapterStatus in flow order — a missing entry makes
// currentIndex -1 for chapters in that status, and the quick-advance button
// then offers "Advance to: Draft" (STATUS_FLOW[0]) for a live chapter.
// tests/status-checks.test.ts asserts this stays in sync with
// lib/chapter-validation.ts STATUS_FLOW.
export const STATUS_FLOW: { value: ChapterStatus; label: string; description: string }[] = [
  { value: "draft", label: "Draft", description: "Set up chapter details, dates, and challenges" },
  { value: "announced", label: "Announced", description: "Chapter is visible on the website, applications not yet open" },
  { value: "applications_open", label: "Applications Open", description: "Participants can apply, screen applications as they come in" },
  { value: "preparation", label: "Preparation", description: "Review remaining applications, accept/reject, send emails, check in participants on event day" },
  { value: "challenge_selection", label: "Challenge Selection", description: "Accepted teams select their challenge and form final rosters" },
  { value: "hacking", label: "Hacking", description: "Teams are building; challenge selection is closed, submissions not yet open" },
  { value: "submissions_open", label: "Submissions Open", description: "Teams submit their projects (code repos, descriptions, demos)" },
  { value: "pitching", label: "Pitching", description: "Teams pitch to the jury, jury submits rankings, scores are calculated" },
  { value: "completed", label: "Completed", description: "Scores published, certificates sent, chapter archived" },
];
