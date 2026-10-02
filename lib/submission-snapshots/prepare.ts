import { checkCheckpointBranch, entireGateErrorMessage, isEntireCheckpointRef } from "@/lib/entire";
import { acceptPendingInvite } from "@/lib/github";
import { QUERY_LIMITS } from "@/lib/config/limits";
import type { BlockReason } from "@/lib/submission-blocks";
import type { SubmissionRequirements } from "./types";
import { strictRepository, type RepositorySelection, type CheckpointRef } from "./types";

export class SubmissionVerificationError extends Error {
  constructor(message: string, public reason: BlockReason = "entire_check_unavailable") { super(message); }
}

/** Read source objects once during Submit. No forks or repository copying here. */
export async function prepareSubmissionRepositories(
  fields: Record<string, string>, requirements: SubmissionRequirements,
): Promise<Record<string, RepositorySelection>> {
  // Participant paths never use the privileged settings client. The same bot
  // token must be configured in the web app and background worker.
  const token = process.env.GITHUB_TOKEN;
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const request = async (path: string) => {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new SubmissionVerificationError("GitHub verification could not finish. Please retry before the deadline.");
    }
    if ([401, 403, 429].includes(response.status) || response.status >= 500)
      throw new SubmissionVerificationError("GitHub verification is temporarily unavailable or rate limited. Please retry before the deadline.");
    return response;
  };
  const selections: Record<string, RepositorySelection> = {};
  for (const field of requirements.submission_fields) {
    const value = fields[field.key]?.trim();
    if (field.required && !value) throw new SubmissionVerificationError(`"${field.label}" is required.`);
    if (field.type !== "repo" || !value) continue;
    const { owner, repo } = strictRepository(value);
    const path = `/repos/${owner}/${repo}`;
    let response = await request(path);
    if (response.status === 404 && field.repoAccess !== "public" && token) {
      if (await acceptPendingInvite(owner, repo, token)) response = await request(path);
    }
    if (!response.ok) throw new SubmissionVerificationError("We cannot read this repository. Check its URL and the bot's access, then retry.", "entire_repo_unreadable");
    const source = await response.json();
    if (!Number.isSafeInteger(source.id) || source.id < 1 || typeof source.default_branch !== "string")
      throw new SubmissionVerificationError("GitHub returned an incomplete repository. Please retry.");
    if ((field.repoAccess === "public" && source.private) || (field.repoAccess === "invite_required" && !source.private))
      throw new SubmissionVerificationError("Repository visibility does not match this challenge's requirement.", "entire_repo_unreadable");
    const headResponse = await request(`${path}/git/ref/heads/${encodeURIComponent(source.default_branch)}`);
    if (!headResponse.ok) throw new SubmissionVerificationError("The repository has no readable default branch. Push your code first.", "entire_repo_unreadable");
    const head = await headResponse.json();
    if (!/^[a-f0-9]{40}$/.test(head.object?.sha ?? "")) throw new SubmissionVerificationError("GitHub returned an invalid code version. Please retry.");
    let checkpoints: CheckpointRef[] = [];
    if (requirements.entire_required) {
      const refsResponse = await request(`${path}/git/matching-refs/`);
      if (!refsResponse.ok) throw new SubmissionVerificationError("We could not list Entire checkpoints. Please retry.");
      const refs: unknown = await refsResponse.json();
      if (!Array.isArray(refs)) throw new SubmissionVerificationError("GitHub returned an incomplete checkpoint list.");
      checkpoints = refs.filter(r => typeof r?.ref === "string" && isEntireCheckpointRef(r.ref)).map(r => ({ ref: r.ref, sha: r.object?.sha }));
      if (checkpoints.length > QUERY_LIMITS.entireCheckpointRefs || checkpoints.some(r => !/^[a-f0-9]{40}$/.test(r.sha ?? "")))
        throw new SubmissionVerificationError("We could not verify the complete checkpoint list. Contact an organizer.");
      const check = await checkCheckpointBranch(owner, repo, { token: token ?? null, checkpointRefs: checkpoints });
      if (!check.satisfiesGate) throw new SubmissionVerificationError(entireGateErrorMessage(check),
        check.checkUnavailable ? "entire_check_unavailable" : check.repoUnreadable ? "entire_repo_unreadable" : "entire_missing");
    }
    selections[field.key] = { repo_url: `https://github.com/${owner}/${repo}`, repository_id: source.id,
      frozen_sha: head.object.sha, entire_required: requirements.entire_required, checkpoint_manifest: checkpoints };
  }
  return selections;
}
