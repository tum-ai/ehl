import type { Submission, SubmissionFieldConfig } from "@/lib/types";
import type { CheckpointRef, RepositorySelection } from "./types";
import { strictRepository } from "./types";

export interface SubmissionRepository {
  repoUrl: string;
  commitSha?: string;
  checkpointRefs?: CheckpointRef[];
  href: string;
  missingFork: boolean;
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const { owner, repo } = strictRepository(value);
    return `https://github.com/${owner}/${repo}`;
  } catch { return null; }
}

function validSelection(value: RepositorySelection | undefined): value is RepositorySelection {
  return !!value && !!repositoryUrl(value.repo_url) && Number.isSafeInteger(value.repository_id) && value.repository_id > 0 &&
    typeof value.frozen_sha === "string" && /^[a-f0-9]{40}$/.test(value.frozen_sha) &&
    typeof value.entire_required === "boolean" && Array.isArray(value.checkpoint_manifest) &&
    value.checkpoint_manifest.every(ref => ref && typeof ref.ref === "string" &&
      typeof ref.sha === "string" && /^[a-f0-9]{40}$/.test(ref.sha));
}

/** One source of truth for review inputs and repository links. New receipts
 * always select accepted objects; a delayed/failed copy cannot select newer code.
 * Only revision zero retains the historical mutable repository fallback. */
export function selectSubmissionRepository(
  submission: Submission,
  fields: SubmissionFieldConfig[],
  fieldKey?: string
): SubmissionRepository | null {
  const repositoryFields = fields.filter(field => field.type === "repo" && submission.fields[field.key]);
  const primary = repositoryFields[0]?.key;
  const key = fieldKey ?? primary;
  const fork = repositoryUrl(submission.forkUrl?.replace(/\/tree\/[a-f0-9]{40}\/?$/, ""));

  if ((submission.submissionRevision ?? 0) === 0) {
    const lowerFields = Object.fromEntries(Object.entries(submission.fields).map(([name, value]) => [name.toLowerCase(), value]));
    const original = key ? submission.fields[key] : lowerFields.repo || lowerFields.github || lowerFields.repository ||
      Object.values(submission.fields).find(value => repositoryUrl(value));
    const repoUrl = fork || repositoryUrl(original);
    if (!repoUrl) return null;
    return { repoUrl, commitSha: submission.snapshotSha || undefined,
      href: submission.forkUrl || original || repoUrl, missingFork: !fork };
  }

  if (!key || !repositoryFields.some(field => field.key === key)) return null;
  const accepted = submission.repoSnapshots?.[key];
  if (!validSelection(accepted) || repositoryUrl(submission.fields[key])?.toLowerCase() !== accepted.repo_url.toLowerCase()) return null;
  // The existing fork_url/snapshot_sha columns describe only the primary repo.
  // Other fields must use their own accepted source commit, never that fork.
  const copied = key === primary && !!fork && submission.snapshotSha === accepted.frozen_sha;
  const repoUrl = copied ? fork : accepted.repo_url;
  return {
    repoUrl, commitSha: accepted.frozen_sha, checkpointRefs: accepted.checkpoint_manifest,
    href: `${repoUrl}/tree/${accepted.frozen_sha}`, missingFork: !copied,
  };
}
