import type { SubmissionFieldConfig } from "@/lib/types";

export interface SubmissionRequirements {
  entire_required: boolean;
  submission_fields: SubmissionFieldConfig[];
  revision: number;
}

/** Verified server input to the service-only database save. */
export interface SubmissionReceipt {
  user_id: string;
  challenge_id: string;
  team_id: string;
  project_name: string;
  short_description: string | null;
  fields: Record<string, string>;
  tech_stack: string[];
  requirements: SubmissionRequirements;
  repo_snapshots: Record<string, RepositorySelection>;
}

export interface CheckpointRef {
  ref: string;
  sha: string;
}
/** Source objects verified and accepted during Submit, before the deadline. */
export interface RepositorySelection {
  repo_url: string;
  repository_id: number;
  frozen_sha: string;
  entire_required: boolean;
  checkpoint_manifest: CheckpointRef[];
}
/** Destination/progress for copying an already accepted repository selection. */
export interface RepositoryCapture extends RepositorySelection {
  fork_url: string;
  revision: number;
}
export const CAPTURE_LIMITS = {
  archiveBytes: 50 * 1024 * 1024,
  expandedBytes: 250 * 1024 * 1024,
  archiveFiles: 50000,
};
export function strictRepository(url: string) {
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(
      url,
    );
  if (!match) throw new Error("Invalid GitHub repository URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}
