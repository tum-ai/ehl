import { Badge } from "@/components/ui/badge";
import { formatDateFull, formatDeadline } from "@/lib/utils";
import { SubmissionForm } from "@/components/submission/submission-form";
import { DeadlineCountdown } from "@/components/submission/deadline-countdown";
import type { Chapter, Challenge, Submission } from "@/lib/types";

interface ChapterSubmissionsOpenProps {
  chapter: Chapter;
  challenges: Challenge[];
  teamChallengeId: string | null;
  submission: Submission | null;
  teamId: string | null;
  userRole: "president" | "member" | null;
}

export function ChapterSubmissionsOpen({
  chapter,
  challenges,
  teamChallengeId,
  submission,
  teamId,
  userRole,
}: ChapterSubmissionsOpenProps) {
  const registeredChallenge = challenges.find((c) => c.id === teamChallengeId);
  const deadlinePassed = chapter.submissionDeadline
    ? new Date(chapter.submissionDeadline) <= new Date()
    : false;
  const isLocked = (submission?.isLocked ?? false) || deadlinePassed;

  return (
    <div className="relative">
      <div className="glow-blob glow-blob-gold absolute -right-60 -top-40 h-[500px] w-[500px] opacity-10" />

      <div className="relative">
        <Badge variant="announced">Submissions Open</Badge>
        <h1 className="mt-4 font-hero-display text-3xl font-black sm:text-4xl lg:text-5xl">
          {chapter.name}
        </h1>
        <p className="mt-3 text-text-secondary">
          {chapter.city}, {chapter.country} &middot; {formatDateFull(chapter.date, chapter.dateEnd)}
        </p>
        {chapter.description && (
          <p className="mt-4 max-w-2xl font-hero-body leading-relaxed text-text-secondary">
            {chapter.description}
          </p>
        )}
      </div>

      {/* Deadline with countdown */}
      {chapter.submissionDeadline && (
        <DeadlineCountdown deadline={chapter.submissionDeadline} />
      )}

      {/* Submission status */}
      {registeredChallenge && teamId && userRole && (
        submission ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/[0.03] px-5 py-3">
            <svg className="h-5 w-5 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-green-400">
                Submitted: {submission.projectName}
              </p>
              <p className="text-xs text-text-muted">
                Last updated {formatDeadline(submission.updatedAt)}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-5 py-3">
            <svg className="h-5 w-5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm font-medium text-amber-400">
              Not yet submitted. Fill in the form below.
            </p>
          </div>
        )
      )}

      {/* Submission form for any registered team member */}
      {registeredChallenge && teamId && userRole && (
        <div className="mt-8">
          <SubmissionForm
            challengeId={registeredChallenge.id}
            teamId={teamId}
            submissionFields={registeredChallenge.submissionFields}
            existing={submission}
            isLocked={isLocked}
            deadline={chapter.submissionDeadline}
            entireRequired={registeredChallenge.entireRequired}
          />
        </div>
      )}

      {/* Not logged in or no team */}
      {!teamChallengeId && !userRole && (
        <div className="mt-8 rounded-2xl border border-white/[0.06] bg-surface-card/40 p-6">
          <p className="text-text-muted">
            Log in to see your submission options.
          </p>
        </div>
      )}

      {/* All challenges with full details */}
      <div className="mt-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-purple/30" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">
            Challenges
          </h2>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-purple/30" />
        </div>

        <div className="space-y-6">
          {challenges.map((challenge) => {
            const isRegistered = teamChallengeId === challenge.id;

            return (
              <div
                key={challenge.id}
                className={`overflow-hidden rounded-2xl border transition-all ${isRegistered ? "border-gold/30 bg-gold/[0.02]" : "border-white/[0.06] bg-surface-card/60"}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-6 pb-0">
                  <div className="flex items-start gap-4">
                    {challenge.sponsorLogoUrl && (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2">
                        <img
                          src={challenge.sponsorLogoUrl}
                          alt={challenge.sponsorName || ""}
                          className="h-full w-auto object-contain"
                        />
                      </div>
                    )}
                    <div>
                      <h3 className="font-hero-heading text-xl font-bold">{challenge.title}</h3>
                      {challenge.sponsorName && (
                        <p className="mt-0.5 text-sm text-text-muted">by {challenge.sponsorName}</p>
                      )}
                    </div>
                  </div>
                  {isRegistered && (
                    <Badge variant="completed">Your Challenge</Badge>
                  )}
                </div>

                {/* Description */}
                {challenge.description && (
                  <div className="px-6 pt-4">
                    <p className="whitespace-pre-line font-hero-body leading-relaxed text-text-secondary">
                      {challenge.description}
                    </p>
                  </div>
                )}

                {/* Info grid */}
                {(challenge.judgingCriteria || challenge.prizeDescription) && (
                  <div className="mt-4 grid gap-px border-t border-white/[0.06] sm:grid-cols-2">
                    {challenge.judgingCriteria && (
                      <div className="border-b border-white/[0.06] p-6 sm:border-b-0 sm:border-r">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-purple-light/70">
                          Judging Criteria
                        </p>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{challenge.judgingCriteria}</p>
                      </div>
                    )}
                    {challenge.prizeDescription && (
                      <div className="p-6">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-gold/70">
                          Prize
                        </p>
                        <p className="whitespace-pre-line text-sm font-medium text-gold">{challenge.prizeDescription}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Submission requirements */}
                {challenge.submissionFields.length > 0 && (
                  <div className="border-t border-white/[0.06] p-6">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
                      Submission Requirements
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {challenge.submissionFields.map((field) => (
                        <span
                          key={field.key}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${field.required ? "border-purple/20 bg-purple/5 text-purple-light" : "border-white/10 bg-white/[0.03] text-text-secondary"}`}
                        >
                          {field.label}
                          {field.required && (
                            <span className="h-1 w-1 rounded-full bg-gold" />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Challenge Brief PDF */}
                {challenge.briefFileId && (
                  <div className="border-t border-white/[0.06] p-6">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
                      Challenge Brief
                    </p>
                    <div className="overflow-hidden rounded-xl border border-white/10" style={{ height: "500px" }}>
                      <iframe
                        src={`/api/challenges/${challenge.id}/brief`}
                        className="h-full w-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
