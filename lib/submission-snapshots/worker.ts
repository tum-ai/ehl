import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubmissionFieldConfig } from "@/lib/types";
import { GitHubFailure, SnapshotGitHub } from "./github-client";
import { strictRepository, type RepositoryCapture, type RepositorySelection } from "./types";

// complete is absent until the destination exists, false while copying, true
// after verification. This also distinguishes creation delay from lost access.
type Copy = RepositoryCapture & { complete?: boolean; invited?: string[] };
interface Job {
  submission_id: string;
  revision: number;
  lease_token: string;
  failures: number;
  step: Record<string, Copy>;
}
class SnapshotLeaseLost extends Error {}
type Transfer = (
  copy: RepositoryCapture,
  heartbeat: () => Promise<void>,
) => Promise<void>;

function validSelection(value: unknown): value is RepositorySelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<RepositorySelection>;
  return typeof selection.repo_url === "string" &&
    Number.isSafeInteger(selection.repository_id) && selection.repository_id! > 0 &&
    typeof selection.frozen_sha === "string" && /^[a-f0-9]{40}$/.test(selection.frozen_sha) &&
    typeof selection.entire_required === "boolean" &&
    Array.isArray(selection.checkpoint_manifest) &&
    selection.checkpoint_manifest.every(checkpoint => checkpoint &&
      typeof checkpoint.ref === "string" && typeof checkpoint.sha === "string" &&
      /^[a-f0-9]{40}$/.test(checkpoint.sha));
}

function matchesSelection(copy: Copy, selection: RepositorySelection, revision: number) {
  return validSelection(copy) && copy.revision === revision &&
    Object.keys(copy).every(key => [
      "repo_url", "repository_id", "frozen_sha", "entire_required", "checkpoint_manifest",
      "fork_url", "revision", "complete", "invited",
    ].includes(key)) &&
    copy.repo_url === selection.repo_url && copy.repository_id === selection.repository_id &&
    copy.frozen_sha === selection.frozen_sha && copy.entire_required === selection.entire_required &&
    copy.checkpoint_manifest.length === selection.checkpoint_manifest.length &&
    copy.checkpoint_manifest.every((checkpoint, index) =>
      checkpoint.ref === selection.checkpoint_manifest[index].ref &&
      checkpoint.sha === selection.checkpoint_manifest[index].sha);
}

/** One saved submission per leased job. No recurring observations or alternate modes. */
export class SnapshotWorker {
  constructor(
    private db: SupabaseClient,
    private token: string,
    private org: string,
    private transfer: Transfer,
  ) {}
  async runOne(): Promise<boolean> {
    const { data, error } = await this.db.rpc("claim_submission_snapshot", {
      p_lease: randomUUID(),
    });
    if (error) throw new Error("Cannot claim snapshot job");
    const job = data?.[0] as Job | undefined;
    if (!job) return false;
    const progress = async (
      status = "running",
      extra: Record<string, unknown> = {},
    ) => {
      const { data: saved, error } = await this.db.rpc(
        "update_submission_snapshot",
        {
          p_id: job.submission_id,
          p_revision: job.revision,
          p_lease: job.lease_token,
          p_status: status,
          p_step: job.step,
          ...extra,
        },
      );
      if (error) throw new Error("Cannot update snapshot job progress");
      if (!saved)
        throw new SnapshotLeaseLost("Snapshot job was superseded or its lease expired");
    };
    const github = new SnapshotGitHub(this.db, this.token, () => progress());
    try {
      const { data: submission, error: readError } = await this.db
        .from("submissions")
        .select("*")
        .eq("id", job.submission_id)
        .single();
      if (readError || !submission) throw new Error("Cannot read submission");
      // Every heartbeat submits the entire progress object to SQL. Validate all
      // saved entries first, including entries after the first repository field.
      for (const [key, copy] of Object.entries(job.step)) {
        const selection = submission.repo_snapshots?.[key];
        if (!validSelection(selection)) {
          job.step = {};
          throw new GitHubFailure(
            "No accepted repository version is available for this submission",
            "configuration",
          );
        }
        if (!matchesSelection(copy, selection, job.revision)) {
          job.step = {};
          throw new GitHubFailure(
            "Saved copy does not match the accepted repository version",
            "configuration",
          );
        }
      }
      const { data: challenge, error: challengeError } = await this.db
        .from("challenges")
        .select(
          "submission_fields,entire_required,invite_jury_to_forks,code_review_enabled",
        )
        .eq("id", submission.challenge_id)
        .single();
      if (challengeError || !challenge)
        throw new Error("Cannot read challenge");
      const fields = (
        challenge.submission_fields as SubmissionFieldConfig[]
      ).filter((f) => f.type === "repo" && submission.fields[f.key]);
      for (const field of fields) {
        const selection = submission.repo_snapshots?.[field.key];
        if (!validSelection(selection)) {
          // SQL binds all reported progress to accepted inputs. Old incompatible
          // progress must not prevent recording a visible configuration failure.
          job.step = {};
          throw new GitHubFailure(
            "No accepted repository version is available for this submission",
            "configuration",
          );
        }
        const source = strictRepository(selection.repo_url);
        const submitted = strictRepository(submission.fields[field.key]);
        if (`${source.owner}/${source.repo}`.toLowerCase() !== `${submitted.owner}/${submitted.repo}`.toLowerCase())
          throw new GitHubFailure(
            "Accepted repository does not match the submission",
            "configuration",
          );
        let copy = job.step[field.key];
        if (!copy) {
          const path = `/repos/${source.owner}/${source.repo}`;
          const destination = `/repos/${this.org}/submission-${job.submission_id}-${selection.repository_id}`;
          let forkResponse = await github.request(
            destination,
            "GET",
            undefined,
            [404],
          );
          if (forkResponse.status === 404) {
            // Only check identity/access here. Version selection happened before
            // receipt; never resolve HEAD, checkpoint refs or invitations again.
            const response = await github.request(path, "GET", undefined, [404]);
            if (response.status === 404)
              throw new GitHubFailure("Repository is not accessible to the bot", "access");
            const info = await response.json();
            if (info.id !== selection.repository_id)
              throw new GitHubFailure(
                "Repository identity no longer matches the accepted submission",
                "access",
              );
            forkResponse = await github.request(`${path}/forks`, "POST", {
              organization: this.org,
              name: destination.split("/").pop(),
              default_branch_only: true,
            });
          }
          const fork = await forkResponse.json();
          const forkParsed = strictRepository(fork.html_url);
          if (forkParsed.owner.toLowerCase() !== this.org.toLowerCase())
            throw new GitHubFailure(
              "Unexpected fork organization",
              "configuration",
            );
          copy = {
            ...structuredClone(selection),
            fork_url: fork.html_url,
            revision: job.revision,
            ...(forkResponse.status === 200 ? { complete: false } : {}),
          };
          job.step[field.key] = copy;
          await progress();
        }
        const target = strictRepository(copy.fork_url);
        if (target.owner.toLowerCase() !== this.org.toLowerCase())
          throw new GitHubFailure("Unexpected fork organization", "configuration");
        const fork = await github.request(
          `/repos/${target.owner}/${target.repo}`,
          "GET",
          undefined,
          [404, 202],
        );
        if (fork.status === 404 && copy.complete !== undefined)
          throw new GitHubFailure("Snapshot repository is no longer accessible", "access");
        if (fork.status === 404 || fork.status === 202)
          throw new GitHubFailure("Fork creation is pending", "transient", 15);
        const info = await fork.json();
        if (
          ![info.parent?.id, info.source?.id].includes(selection.repository_id)
        )
          throw new GitHubFailure(
            "Fork belongs to a different source",
            "configuration",
          );
        if (!copy.complete) {
          if (copy.complete === undefined) {
            copy.complete = false;
            await progress();
          }
          await this.transfer(copy, () => progress());
          const ref = await github.json<{ object: { sha: string } }>(
            `/repos/${target.owner}/${target.repo}/git/ref/heads/ehl-final/${copy.revision}`,
          );
          if (ref.object.sha !== copy.frozen_sha)
            throw new Error("Copied commit does not match");
          copy.complete = true;
          await progress();
        }
      }
      const primary = job.step[fields[0]?.key];
      // A jury invitation failure must not hide an already completed copy.
      await progress("running", {
        p_fork: primary?.fork_url ?? null,
        p_sha: primary?.frozen_sha ?? null,
      });
      const juryErrors: string[] = [];
      for (const field of fields) {
        const copy = job.step[field.key];
        const target = strictRepository(copy.fork_url);
        // Keep the existing individual collaborator model, only at final lock.
        if (submission.is_locked && challenge.invite_jury_to_forks) {
          const { data: assignments, error } = await this.db
            .from("jury_assignments")
            .select("user_id")
            .eq("challenge_id", submission.challenge_id);
          if (error) throw new Error("Cannot read jury assignments");
          if (assignments?.length) {
            const { data: profiles, error } = await this.db
              .from("profiles")
              .select("email,github_username")
              .in(
                "id",
                assignments.map((a) => a.user_id),
              );
            if (error) throw new Error("Cannot read jury identities");
            for (const profile of profiles ?? []) {
              let username = profile.github_username;
              if (!username) {
                const result = await github.json<{
                  items: Array<{ login: string }>;
                }>(
                  `/search/users?q=${encodeURIComponent(`${profile.email} in:email`)}`,
                );
                username = result.items[0]?.login;
              }
              if (!username) {
                juryErrors.push("A juror needs a GitHub username");
                continue;
              }
              if (copy.invited?.includes(username)) continue;
              await github.json(
                `/repos/${target.owner}/${target.repo}/collaborators/${encodeURIComponent(username)}`,
                "PUT",
                { permission: "pull" },
              );
              copy.invited = [...(copy.invited ?? []), username];
              await progress();
            }
          }
        }
      }
      if (juryErrors.length) throw new GitHubFailure(juryErrors.join("; "), "access");
      // Finish after all copies and invitations succeeded for this revision.
      await progress("done", {
        p_fork: primary?.fork_url ?? null,
        p_sha: primary?.frozen_sha ?? null,
      });
    } catch (error) {
      // Closing the deadline or resubmitting deliberately invalidates a lease.
      // The successor owns the job now; do not write again or stop other jobs.
      if (error instanceof SnapshotLeaseLost) return true;
      const failure =
        error instanceof GitHubFailure
          ? error
          : new GitHubFailure(
              "Repository copy failed; retry scheduled",
              "transient",
            );
      const exhausted =
        failure.kind !== "rate_limit" &&
        (failure.kind !== "transient" || job.failures >= 4);
      // A quota pause consumes no failure attempt. Permanent failures remain visible
      // in the existing admin submission view and can be retried after correction.
      try {
        await progress(exhausted ? "failed" : "queued", {
          p_delay: failure.retrySeconds,
          p_error: failure.message,
          p_failure: failure.kind !== "rate_limit",
        });
      } catch (reportError) {
        if (!(reportError instanceof SnapshotLeaseLost)) throw reportError;
      }
    }
    return true;
  }
}
