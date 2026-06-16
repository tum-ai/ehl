import { NextResponse } from "next/server";
import { getSession } from "@/lib/actions/auth";
import { parseGitHubRepo, getEhlUsername, acceptPendingInvite } from "@/lib/github";
import { getSettingValue, SETTING_KEYS } from "@/lib/settings";
import { checkRateLimit, apiLimiter } from "@/lib/ratelimit";
import { checkCheckpointBranch, entireGateErrorMessage } from "@/lib/entire";

const EHL_GITHUB_USERNAME = getEhlUsername();

/**
 * Live, non-blocking Entire session-history feedback for a verified repo. The
 * authoritative hard gate runs server-side in submitProject; this just lets the
 * team see, before submitting, whether their checkpoint branch is present.
 * Returns {} when entireRequired is off so existing behavior is unchanged.
 */
async function entireFeedback(
  owner: string,
  repo: string,
  entireRequired: boolean
): Promise<{ entireOk?: boolean; entireWarning?: string }> {
  if (!entireRequired) return {};
  try {
    const check = await checkCheckpointBranch(owner, repo);
    return check.satisfiesGate
      ? { entireOk: true }
      : { entireOk: false, entireWarning: entireGateErrorMessage(check) };
  } catch {
    // Never let the live check break verification: stay silent on transient errors.
    return {};
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Rate limiting: 60 requests per minute per user
  const rl = await checkRateLimit(apiLimiter, session.user.id);
  if (rl.limited) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  const body = await request.json();
  const { repoUrl, accessMode, entireRequired } = body as {
    repoUrl: string;
    accessMode: "public" | "invite_required" | "any";
    entireRequired?: boolean;
  };

  if (!repoUrl) {
    return NextResponse.json({ error: "No repository URL provided" }, { status: 400 });
  }

  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) {
    return NextResponse.json({
      valid: false,
      error: "Invalid GitHub repository URL. Use the format: https://github.com/owner/repo",
    });
  }

  const { owner, repo } = parsed;
  const githubToken = await getSettingValue(SETTING_KEYS.GITHUB_TOKEN, process.env.GITHUB_TOKEN);
  const authHeaders = {
    Accept: "application/vnd.github.v3+json",
    ...(githubToken ? { Authorization: `token ${githubToken}` } : {}),
  };

  try {
    // Try to access the repo. For private repos where ehl-gg has a pending
    // invite, this will 404. We'll accept the invite and retry.
    let repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders,
    });

    // For modes that allow private repos, try accepting pending invites on 404
    const allowsPrivate = accessMode === "invite_required" || accessMode === "any";
    if (repoRes.status === 404 && allowsPrivate && githubToken) {
      const accepted = await acceptPendingInvite(owner, repo);
      if (accepted) {
        repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: authHeaders,
        });
      }
    }

    if (repoRes.status === 404) {
      if (accessMode === "public") {
        return NextResponse.json({
          valid: false,
          error: "Repository not found. Make sure it exists and is public.",
        });
      }
      return NextResponse.json({
        valid: false,
        error: `Repository not found or not accessible. Please invite "${EHL_GITHUB_USERNAME}" as a collaborator on GitHub, then click Verify again.`,
      });
    }

    if (!repoRes.ok) {
      return NextResponse.json({
        valid: false,
        error: "Could not verify repository. Please try again later.",
      });
    }

    const repoData = await repoRes.json();
    const isPrivate = repoData.private;

    // ── Mode: public (must be public) ─────────────────────
    if (accessMode === "public") {
      if (isPrivate) {
        return NextResponse.json({
          valid: false,
          error: "This repository is private. It must be public for this challenge.",
        });
      }
      return NextResponse.json({
        valid: true,
        repoName: `${owner}/${repo}`,
        isPrivate: false,
        ...(await entireFeedback(owner, repo, !!entireRequired)),
      });
    }

    // ── Mode: invite_required (must be private) ───────────
    if (accessMode === "invite_required" && !isPrivate) {
      return NextResponse.json({
        valid: false,
        error: "This repository is public. For this challenge, your repository must be private. Please change its visibility to private on GitHub.",
      });
    }

    // ── Modes: invite_required + any ──────────────────────
    // Public repo in "any" mode: valid, no invite needed
    if (!isPrivate) {
      return NextResponse.json({
        valid: true,
        repoName: `${owner}/${repo}`,
        isPrivate: false,
        ...(await entireFeedback(owner, repo, !!entireRequired)),
      });
    }

    // Private repo: verify ehl-gg has collaborator access
    if (!githubToken) {
      return NextResponse.json({
        valid: true,
        repoName: `${owner}/${repo}`,
        isPrivate: true,
        warning: `Repository is private. Please make sure "${EHL_GITHUB_USERNAME}" has been invited as a collaborator.`,
      });
    }

    // Check collaborator status, auto-accept pending invite if needed
    let collabRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/collaborators/${EHL_GITHUB_USERNAME}`,
      { headers: authHeaders }
    );

    if (collabRes.status !== 204) {
      const accepted = await acceptPendingInvite(owner, repo);
      if (accepted) {
        collabRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/collaborators/${EHL_GITHUB_USERNAME}`,
          { headers: authHeaders }
        );
      }
    }

    if (collabRes.status === 204) {
      return NextResponse.json({
        valid: true,
        repoName: `${owner}/${repo}`,
        isPrivate: true,
        hasAccess: true,
        ...(await entireFeedback(owner, repo, !!entireRequired)),
      });
    }

    return NextResponse.json({
      valid: false,
      error: `"${EHL_GITHUB_USERNAME}" does not have access to this private repository. Please invite "${EHL_GITHUB_USERNAME}" as a collaborator on GitHub, then click Verify again.`,
    });
  } catch {
    return NextResponse.json({
      valid: false,
      error: "Could not connect to GitHub. Please try again later.",
    });
  }
}
