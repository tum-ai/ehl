/**
 * GitHub `repository_dispatch` trigger for the code-review worker.
 *
 * The admin "Queue Review" flow only WRITES status=queued to the DB. The actual
 * pipeline runs in GitHub Actions (`.github/workflows/process-code-reviews.yml`),
 * which is triggered by a `repository_dispatch` event of type "process-code-reviews".
 *
 * Historically this dispatch was fire-and-forget with ALL errors swallowed, and it
 * did not even check the HTTP response. `fetch()` only rejects on network failure,
 * NOT on a 401/404 — so a missing/expired GITHUB_TOKEN, a wrong GITHUB_REPO, or a
 * renamed workflow returned silently while the admin saw "Queued" forever and the
 * worker never ran. This helper makes the outcome observable: it returns a
 * structured result the caller can surface to the admin and log.
 */

export type DispatchResult =
  | { attempted: false; ok: false; reason: "not_configured"; message: string }
  | { attempted: true; ok: true; status: number }
  | {
      attempted: true;
      ok: false;
      reason: "http_error" | "network_error";
      status?: number;
      message: string;
    };

export const DISPATCH_EVENT_TYPE = "process-code-reviews";

/**
 * POST a repository_dispatch to trigger the code-review worker workflow.
 *
 * Returns a structured result instead of throwing or swallowing. The caller is
 * responsible for surfacing `ok === false` to the operator. We never throw here:
 * a failed dispatch must not roll back the queued DB rows (they can be processed
 * manually via `workflow_dispatch` or a re-queue), but it MUST be visible.
 */
export async function dispatchCodeReviewWorker(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<DispatchResult> {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
  const doFetch = opts?.fetchImpl ?? fetch;

  if (!githubToken || !githubRepo) {
    const missing = [
      !githubToken ? "GITHUB_TOKEN" : null,
      !githubRepo ? "GITHUB_REPO" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    return {
      attempted: false,
      ok: false,
      reason: "not_configured",
      message: `Worker not triggered: ${missing} is not set. Reviews are queued but no GitHub Actions run was started.`,
    };
  }

  try {
    const res = await doFetch(
      `https://api.github.com/repos/${githubRepo}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({ event_type: DISPATCH_EVENT_TYPE }),
      }
    );

    if (!res.ok) {
      // GitHub returns 401 (bad token), 403 (insufficient scope), 404 (wrong repo
      // OR token lacks access). The body often explains which.
      let detail = "";
      try {
        const txt = await res.text();
        detail = txt ? `: ${txt.slice(0, 300)}` : "";
      } catch {
        /* ignore body read errors */
      }
      return {
        attempted: true,
        ok: false,
        reason: "http_error",
        status: res.status,
        message: `GitHub dispatch failed (HTTP ${res.status})${detail}`,
      };
    }

    return { attempted: true, ok: true, status: res.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      attempted: true,
      ok: false,
      reason: "network_error",
      message: `GitHub dispatch network error: ${message}`,
    };
  }
}
