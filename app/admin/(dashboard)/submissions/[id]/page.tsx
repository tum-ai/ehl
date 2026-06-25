import { notFound } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireGlobalAdminPage } from "@/lib/admin-auth";
import {
  getSubmissionById,
  getChallengeById,
  getTeams,
  getCodeReviewForSubmissionAuthenticated,
} from "@/lib/queries";
import { ReportCard } from "@/components/code-review/report-card";
import { formatDate } from "@/lib/utils";
import { extractDriveFileId, getDriveEmbedUrl } from "@/lib/drive-embed";
import { ensureFileLinkReadable } from "@/lib/gdrive";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminSubmissionDetailPage({ params }: PageProps) {
  const { id: submissionId } = await params;

  // Global admins only (RLS does not grant chapter_admins read on submissions).
  await requireGlobalAdminPage();

  const submission = await getSubmissionById(submissionId);
  if (!submission) notFound();

  const challenge = await getChallengeById(submission.challengeId);
  if (!challenge) notFound();

  const [teams, codeReview] = await Promise.all([
    getTeams(),
    getCodeReviewForSubmissionAuthenticated(submissionId),
  ]);
  const team = teams.find((t) => t.id === submission.teamId);

  // Split fields into embeddable files, links, and plain text.
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

  // Self-heal Drive access at view time. Submission files get "anyone with the
  // link" access best-effort at upload time; when that grant failed, the Drive
  // /preview iframe rendered "you need access" until a later reload happened to
  // coincide with a backfill. Ensuring access here makes the preview work on the
  // first load. ensureFileLinkReadable never throws, so a Drive hiccup leaves
  // the "Open in new tab" link as the fallback instead of erroring the page.
  await Promise.all(
    embeddableFields.map((f) => {
      const fileId = extractDriveFileId(f.originalUrl);
      return fileId ? ensureFileLinkReadable(fileId) : Promise.resolve(false);
    })
  );

  return (
    <div>
      <Link
        href="/admin/submissions"
        className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
      >
        &larr; Back to submissions
      </Link>

      {/* Challenge context */}
      <Card className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
          Challenge
        </p>
        <p className="mt-1 font-bold ad-text">{challenge.title}</p>
        {challenge.sponsorName && (
          <p className="text-sm ad-text-muted">by {challenge.sponsorName}</p>
        )}
      </Card>

      {/* Team & project header */}
      <div className="mt-6">
        <div className="flex items-center gap-3">
          {team?.logoUrl && (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ad-border border p-2">
              <img
                src={team.logoUrl}
                alt={team.name}
                className="h-full w-auto object-contain"
              />
            </div>
          )}
          <div>
            <p className="text-sm ad-text-muted">{team?.name ?? "Unknown team"}</p>
            <h1 className="ad-title text-2xl">{submission.projectName}</h1>
          </div>
        </div>
        {submission.shortDescription && (
          <p className="mt-3 leading-relaxed ad-text-secondary">
            {submission.shortDescription}
          </p>
        )}
        <p className="mt-2 text-xs ad-text-muted">
          Submitted {formatDate(submission.submittedAt)} · Updated{" "}
          {formatDate(submission.updatedAt)}
          {submission.isLocked ? " · Locked" : ""}
        </p>
      </div>

      {/* Tech stack */}
      {submission.techStack.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {submission.techStack.map((tech) => (
            <Badge key={tech} variant="default" light>
              {tech}
            </Badge>
          ))}
        </div>
      )}

      {/* Links */}
      {(linkFields.length > 0 || textFields.length > 0) && (
        <Card className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider ad-text-muted">
            Links
          </h2>
          <div className="mt-3 space-y-3">
            {linkFields.map((field) => (
              <div key={field.label} className="flex items-center justify-between">
                <span className="text-sm ad-text-muted">{field.label}</span>
                <a
                  href={field.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm ad-text-link hover:underline"
                >
                  {field.type === "repo" ? "View Repository" : field.label}
                </a>
              </div>
            ))}
            {textFields.map((field) => (
              <div key={field.label}>
                <span className="text-sm ad-text-muted">{field.label}</span>
                <p className="mt-0.5 text-sm ad-text-secondary">{field.value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Embedded documents (pitch deck, etc.) */}
      {embeddableFields.map((field) => (
        <div key={field.label} className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider ad-text-muted">
              {field.label}
            </h2>
            <a
              href={field.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs ad-text-link hover:underline"
            >
              Open in new tab
            </a>
          </div>
          <div className="mt-2 overflow-hidden rounded-xl ad-border border">
            <iframe
              src={field.embedUrl}
              className="w-full"
              style={{ height: "600px" }}
              allow="autoplay"
            />
          </div>
        </div>
      ))}

      {/* Code review */}
      {challenge.codeReviewEnabled &&
        codeReview?.status === "completed" &&
        codeReview.reviewContent && (
          <Card className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider ad-text-muted">
                Code Review
              </h2>
              <Badge variant="completed" light>
                Completed
              </Badge>
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

      {challenge.codeReviewEnabled &&
        codeReview &&
        codeReview.status !== "completed" && (
          <Card className="mt-6">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-bold uppercase tracking-wider ad-text-muted">
                Code Review
              </h2>
              <Badge variant="announced" light>
                {codeReview.status}
              </Badge>
            </div>
          </Card>
        )}
    </div>
  );
}
