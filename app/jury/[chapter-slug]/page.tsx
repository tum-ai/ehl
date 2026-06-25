import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/actions/auth";
import {
  getChapterBySlug,
  resolveJuryAssignment,
  getChallengeById,
  getSubmissionsForChallengeAuthenticated,
  getPitchOrder,
  getTeams,
  getCodeReviewForSubmissionAuthenticated,
} from "@/lib/queries";
import { ReportCard } from "@/components/code-review/report-card";

interface PageProps {
  params: Promise<{ "chapter-slug": string }>;
  searchParams: Promise<{ challenge?: string }>;
}

export default async function JuryChapterPage({ params, searchParams }: PageProps) {
  const { "chapter-slug": slug } = await params;
  const { challenge: challengeIdParam } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/jury/login");

  const chapter = await getChapterBySlug(slug);
  if (!chapter) notFound();

  // Get jury's assignment for this chapter. A juror may be assigned to multiple
  // challenges in the same chapter, so resolve by the clicked challenge id.
  const chapterAssignment = await resolveJuryAssignment(
    session.user.id,
    chapter.id,
    challengeIdParam
  );

  if (!chapterAssignment) {
    return (
      <div>
        <h1 className="text-2xl font-bold">No Assignment</h1>
        <p className="mt-2 text-text-muted">
          You are not assigned to any challenge in this chapter.
        </p>
        <Link href="/jury" className="mt-4 inline-block text-gold hover:underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const challenge = await getChallengeById(chapterAssignment.challengeId);
  if (!challenge) notFound();

  const [submissions, pitchOrder, teams] = await Promise.all([
    getSubmissionsForChallengeAuthenticated(challenge.id),
    getPitchOrder(challenge.id),
    getTeams(),
  ]);

  // Load code reviews for submissions
  const submissionsWithReviews = await Promise.all(
    submissions.map(async (sub) => {
      const review = await getCodeReviewForSubmissionAuthenticated(sub.id);
      return { ...sub, codeReview: review };
    })
  );

  // Order by pitch order if available
  const orderedTeamIds = pitchOrder?.orderList || submissions.map((s) => s.teamId);

  const hasVoted = chapterAssignment.status === "voted";
  const hasSkipped = chapterAssignment.status === "skipped";

  // Carry the resolved challenge id through to sub-pages so they resolve the
  // same assignment (important when the juror has >1 challenge in this chapter).
  const challengeQuery = `?challenge=${chapterAssignment.challengeId}`;

  return (
    <div>
      <Link
        href="/jury"
        className="text-sm text-text-muted hover:text-text-secondary transition-colors"
      >
        &larr; Back to Dashboard
      </Link>

      <div className="mt-6">
        <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
          {chapter.name}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold">{challenge.title}</h1>
          {hasVoted && <Badge variant="completed">Voted</Badge>}
          {hasSkipped && <Badge variant="upcoming">Skipped</Badge>}
        </div>
        {challenge.sponsorName && (
          <p className="text-text-muted">by {challenge.sponsorName}</p>
        )}
      </div>

      {/* Challenge Description / Brief */}
      {challenge.description && (
        <Card className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Challenge Description
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary whitespace-pre-line">
            {challenge.description}
          </p>
        </Card>
      )}

      {challenge.prizeDescription && (
        <Card className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Prize
          </h3>
          <p className="mt-2 text-sm text-text-secondary">{challenge.prizeDescription}</p>
        </Card>
      )}

      {challenge.judgingCriteria && (
        <Card className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Judging Criteria
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary whitespace-pre-line">
            {challenge.judgingCriteria}
          </p>
        </Card>
      )}

      {/* Pitch order */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
            Pitch Order ({orderedTeamIds.length} teams)
          </h2>
          <Link
            href={`/jury/${slug}/rank${challengeQuery}`}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-surface-deep transition-opacity hover:opacity-90"
          >
            {hasVoted ? "Update Vote" : hasSkipped ? "Vote Instead" : "Enter Ranking"}
          </Link>
        </div>

        <div className="mt-4 space-y-3">
          {orderedTeamIds.map((teamId, index) => {
            const team = teams.find((t) => t.id === teamId);
            const sub = submissionsWithReviews.find((s) => s.teamId === teamId);

            if (!team) return null;

            return (
              <Card key={teamId}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple/10 font-mono text-sm font-bold text-purple">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-bold">{team.name}</p>
                      {sub ? (
                        <div className="mt-1">
                          <p className="text-sm text-gold">{sub.projectName}</p>
                          {sub.shortDescription && (
                            <p className="mt-1 text-sm text-text-secondary">
                              {sub.shortDescription}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-text-muted">
                          Registered, but did not submit a project. Nothing to
                          review, and this team cannot be ranked.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {sub ? (
                      sub.codeReview?.status === "completed" && (
                        <Badge variant="announced">Code Review</Badge>
                      )
                    ) : (
                      <Badge variant="upcoming">No submission</Badge>
                    )}
                  </div>
                </div>

                {/* Submission details */}
                {sub && (
                  <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
                    {challenge.submissionFields.map((fieldConfig) => {
                      const value = sub.fields[fieldConfig.key];
                      if (!value) return null;

                      const isRepo = fieldConfig.type === "repo";
                      const displayUrl = isRepo && sub.forkUrl ? sub.forkUrl : value;

                      return (
                        <div key={fieldConfig.key} className="flex items-center justify-between text-sm">
                          <span className="text-text-muted">{fieldConfig.label}</span>
                          {displayUrl.startsWith("http") ? (
                            <a
                              href={displayUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gold hover:underline"
                            >
                              {fieldConfig.type === "file" ? "View File" : fieldConfig.type === "repo" ? "View Repo" : "Open"}
                            </a>
                          ) : (
                            <span className="text-text-secondary">{displayUrl}</span>
                          )}
                        </div>
                      );
                    })}
                    {sub.techStack.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-2">
                        {sub.techStack.map((tech) => (
                          <span
                            key={tech}
                            className="rounded-full bg-surface-deep px-2 py-0.5 text-xs text-text-muted"
                          >
                            {tech}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Code Review */}
                    {sub.codeReview?.status === "completed" && sub.codeReview.reviewContent && (
                      <details className="mt-3 rounded-lg border border-purple/10 bg-purple/[0.03]">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-purple-light">
                          View Code Review
                        </summary>
                        <div className="px-4 pb-4">
                          <ReportCard
                            content={sub.codeReview.reviewContent}
                            metadata={sub.codeReview.repoMetadata}
                            costUsd={sub.codeReview.costUsd}
                          />
                        </div>
                      </details>
                    )}

                    {/* Detail View Link */}
                    <div className="pt-2">
                      <Link
                        href={`/jury/${slug}/submission/${sub.id}${challengeQuery}`}
                        className="text-sm text-gold hover:underline"
                      >
                        View Full Submission &rarr;
                      </Link>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
