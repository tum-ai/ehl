import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
export class GitHubFailure extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "transient"
      | "access"
      | "configuration"
      | "rate_limit",
    public readonly retrySeconds = 60,
  ) {
    super(message);
  }
}
export function safeGitHubMessage(text: string) {
  return text
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+|token\s+\S+)/gi,
      "[redacted]",
    )
    .replace(/https?:\/\/\S+/g, "[url]")
    .slice(0, 300);
}
const identities = new Map<string, string>();
async function responseFailure(response: Response): Promise<GitHubFailure> {
  const message = safeGitHubMessage(
    String(
      (
        await response
          .clone()
          .json()
          .catch(() => ({}))
      ).message ?? `GitHub HTTP ${response.status}`,
    ),
  );
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const retry = Number(response.headers.get("retry-after"));
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      (remaining === "0" || retry > 0 || /rate limit|abuse/i.test(message)));
  const delay =
    retry > 0
      ? retry
      : remaining === "0" && reset * 1000 > Date.now()
        ? Math.ceil((reset * 1000 - Date.now()) / 1000)
        : 60;
  console.error("Snapshot GitHub request failed", {
    status: response.status,
    message,
    remaining,
    reset,
    retryAfter: retry,
    requestId: response.headers.get("x-github-request-id"),
  });
  return new GitHubFailure(
    message,
    limited
      ? "rate_limit"
      : response.status >= 500
        ? "transient"
        : response.status === 401 || response.status === 403
          ? "configuration"
          : "access",
    delay,
  );
}
/** Serial REST calls, paced across worker restarts by account, never by token value. */
export class SnapshotGitHub {
  constructor(
    private db: SupabaseClient,
    private token: string,
    private heartbeat: () => Promise<void> = async () => {},
  ) {}
  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
  }
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    expected: number[] = [],
  ): Promise<Response> {
    const url = new URL(path, "https://api.github.com");
    if (url.origin !== "https://api.github.com")
      throw new Error("Unexpected GitHub origin");
    const fingerprint = createHash("sha256").update(this.token).digest("hex");
    let identity = identities.get(fingerprint);
    if (!identity) {
      const user = await fetch("https://api.github.com/user", {
        headers: this.headers(),
        signal: AbortSignal.timeout(15000),
      });
      if (!user.ok) throw await responseFailure(user);
      const data = await user.json();
      if (!Number.isSafeInteger(data.id))
        throw new GitHubFailure("Invalid bot identity", "configuration");
      identity = `user:${data.id}`;
      identities.set(fingerprint, identity);
    }
    for (;;) {
      await this.heartbeat();
      const { data: delay, error } = await this.db.rpc(
        "reserve_snapshot_request",
        { p_identity: identity, p_write: method !== "GET" },
      );
      if (error)
        throw new GitHubFailure(
          "Cannot reserve GitHub request budget",
          "transient",
        );
      if (delay > 3)
        throw new GitHubFailure(
          "GitHub rate limit: repository copy will retry automatically",
          "rate_limit",
          delay,
        );
      if (!delay) break;
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const update: Record<string, unknown> = {};
    if (remaining !== null) update.remaining = Number(remaining);
    if (reset > 0) update.reset_at = new Date(reset * 1000).toISOString();
    let failure: GitHubFailure | undefined;
    if (!response.ok && !expected.includes(response.status)) {
      failure = await responseFailure(response);
      if (failure.kind === "rate_limit")
        update.pause_until = new Date(
          Date.now() + failure.retrySeconds * 1000,
        ).toISOString();
    }
    if (Object.keys(update).length) {
      const { error } = await this.db
        .from("github_request_budgets")
        .update(update)
        .eq("identity", identity);
      if (error)
        throw new GitHubFailure(
          "Cannot persist GitHub request budget",
          "transient",
        );
    }
    if (failure) throw failure;
    return response;
  }
  async json<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.request(path, method, body);
    return response.status === 204 ? (undefined as T) : await response.json();
  }
}
