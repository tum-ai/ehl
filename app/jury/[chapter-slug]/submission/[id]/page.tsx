import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/actions/auth";
import {
  getChapterBySlug,
  resolveJuryAssignment,
  getChallengeById,
  getSubmissionById,
  getTeams,
  getCodeReviewForSubmissionAuthenticated,
} from "@/lib/queries";
import { ReportCard } from "@/components/code-review/report-card";

interface PageProps {
  params: Promise<{ "chapter-slug": string; id: string }>;
  searchParams: Promise<{ challenge?: string }>;
}

/**
 * Extract a Google Drive file ID from various URL formats.
 * Returns null if the URL is not a recognizable Drive link.
 */
function extractDriveFileId(url: string): string | null {
  // Format: /file/d/{id}/...
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  // Format: ?id={id}
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  // Format: /open?id={id}
  const openMatch = url.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];
  return null;
}

function getDriveEmbedUrl(url: string): string | null {
  const fileId = extractDriveFileId(url);
  if (!fileId) return null;
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export default async function JurySubmissionDetailPage({ params, searchParams }: PageProps) {
  const { "chapter-slug": slug, id: submissionId } = await params;
  const { challenge: challengeIdParam } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/jury/login");

  const chapter = await getChapterBySlug(slug);
  if (!chapter) notFound();

  // Verify jury assignment (resolve the specific challenge the juror is viewing,
  // since a juror may have multiple challenges in the same chapter).
  const chapterAssignment = await resolveJuryAssignment(
    session.user.id,
    chapter.id,
    challengeIdParam
  );
  if (!chapterAssignment) notFound();

  // Fetch submission
  const submission = await getSubmissionById(submissionId);
  if (!submission) notFound();

  // Verify submission belongs to jury's assigned challenge
  if (submission.challengeId !== chapterAssignment.challengeId) notFound();

  const [challenge, teams, codeReview] = await Promise.all([
    getChallengeById(chapterAssignment.challengeId),
    getTeams(),
    getCodeReviewForSubmissionAuthenticated(submissionId),
  ]);

  if (!challenge) notFound();

  const team = teams.find((t) => t.id === submission.teamId);

  // Separate fields into embeddable files and other links
  const embeddableFields: { label: string; embedUrl: string; originalUrl: string }[] = [];
  const linkFields: { label: string; url: string; type: string }[] = [];
  const textFields: { label: string; value: string }[] = [];

  for (const fieldConfig of challenge.submissionFields) {
    const value = submission.fields[fieldConfig.key];
    if (!value) continue;

    const isRepo = fieldConfig.type === "repo";
    const displayUrl = isRepo && submission.forkUrl ? submission.forkUrl : value;

    if (fieldConfig.type === "file") {
      const embedUrl = getDriveEmbedUrl(displayUrl);
      if (embedUrl) {
        embeddableFields.push({ label: fieldConfig.label, embedUrl, originalUrl: displayUrl });
      } else {
        linkFields.push({ label: fieldConfig.label, url: displayUrl, type: "file" });
      }
    } else if (fieldConfig.type === "repo") {
      linkFields.push({ label: fieldConfig.label, url: displayUrl, type: "repo" });
    } else if (displayUrl.startsWith("http")) {
      linkFields.push({ label: fieldConfig.label, url: displayUrl, type: "url" });
    } else {
      textFields.push({ label: fieldConfig.label, value: displayUrl });
    }
  }

  return (
    <div>
      <Link
        href={`/jury/${slug}?challenge=${chapterAssignment.challengeId}`}
        className="text-sm text-text-muted hover:text-text-secondary transition-colors"
      >
        &larr; Back to {challenge.title}
      </Link>

      {/* Challenge Context */}
      <Card className="mt-6">
        <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Challenge
        </p>
        <p className="mt-1 font-bold">{challenge.title}</p>
        {challenge.sponsorName && (
          <p className="text-sm text-text-muted">by {challenge.sponsorName}</p>
        )}
        {challenge.description && (
          <p className="mt-2 text-sm leading-relaxed text-text-secondary whitespace-pre-line">
            {challenge.description}
          </p>
        )}
      </Card>

      {/* Team & Project Header */}
      <div className="mt-6">
        <div className="flex items-center gap-3">
          {team?.logoUrl && (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2">
              <img
                src={team.logoUrl}
                alt={team.name}
                className="h-full w-auto object-contain"
              />
            </div>
          )}
          <div>
            <p className="text-sm text-text-muted">{team?.name}</p>
            <h1 className="text-2xl font-bold">{submission.projectName}</h1>
          </div>
        </div>
        {submission.shortDescription && (
          <p className="mt-3 leading-relaxed text-text-secondary">
            {submission.shortDescription}
          </p>
        )}
      </div>

      {/* Tech Stack */}
      {submission.techStack.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {submission.techStack.map((tech) => (
            <Badge key={tech} variant="default">
              {tech}
            </Badge>
          ))}
        </div>
      )}

      {/* Links (repo, demo, other URLs) */}
      {(linkFields.length > 0 || textFields.length > 0) && (
        <Card className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Links
          </h2>
          <div className="mt-3 space-y-3">
            {linkFields.map((field) => (
              <div key={field.label} className="flex items-center justify-between">
                <span className="text-sm text-text-muted">{field.label}</span>
                <a
                  href={field.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-gold hover:underline"
                >
                  {field.type === "repo" ? (
                    <>
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      View Repository
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {field.label}
                    </>
                  )}
                </a>
              </div>
            ))}
            {textFields.map((field) => (
              <div key={field.label}>
                <span className="text-sm text-text-muted">{field.label}</span>
                <p className="mt-0.5 text-sm text-text-secondary">{field.value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Embedded Documents (Pitch Deck, PDFs, etc.) */}
      {embeddableFields.map((field) => (
        <div key={field.label} className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              {field.label}
            </h2>
            <a
              href={field.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gold hover:underline"
            >
              Open in new tab
            </a>
          </div>
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
            <iframe
              src={field.embedUrl}
              className="h-full w-full"
              style={{ height: "600px" }}
              allow="autoplay"
            />
          </div>
        </div>
      ))}

      {/* Code Review */}
      {challenge.codeReviewEnabled && codeReview?.status === "completed" && codeReview.reviewContent && (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Code Review
            </h2>
            <Badge variant="completed">Completed</Badge>
          </div>
          <div className="mt-4">
            <ReportCard
              content={codeReview.reviewContent}
              metadata={codeReview.repoMetadata}
              costUsd={codeReview.costUsd}
            />
          </div>
        </Card>
      )}

      {/* Code Review Processing Status */}
      {challenge.codeReviewEnabled && codeReview && codeReview.status !== "completed" && (
        <Card className="mt-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Code Review
            </h2>
            {codeReview.status === "queued" && (
              <Badge variant="announced">Queued</Badge>
            )}
            {codeReview.status === "processing" && (
              <Badge variant="announced">Processing</Badge>
            )}
            {codeReview.status === "failed" && (
              <Badge variant="upcoming">Failed</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-text-muted">
            {codeReview.status === "queued"
              ? "Code review is queued and will be processed shortly."
              : codeReview.status === "processing"
                ? "Code review is currently being generated."
                : "Code review generation failed. An admin will retry."}
          </p>
        </Card>
      )}
    </div>
  );
}
