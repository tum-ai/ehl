import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { toChallenge, toSubmission } from "@/lib/queries/mappers";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getSubmissionById: vi.fn(), getChallengeById: vi.fn(), getChapterBySlug: vi.fn(),
  resolveJuryAssignment: vi.fn(), getTeams: vi.fn(), getCodeReviewForSubmissionAuthenticated: vi.fn(),
  getSubmissionsForChallengeAuthenticated: vi.fn(), getPitchOrder: vi.fn(), requireGlobalAdminPage: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/queries", () => mocks);
vi.mock("@/lib/admin-auth", () => ({ requireGlobalAdminPage: mocks.requireGlobalAdminPage }));
vi.mock("@/lib/gdrive", () => ({ ensureFileLinkReadable: vi.fn() }));
vi.mock("@/components/admin/snapshot-retry", () => ({ SnapshotRetry: () => null }));
vi.mock("@/components/code-review/report-card", () => ({ ReportCard: () => null }));

import JuryDetail from "@/app/jury/[chapter-slug]/submission/[id]/page";
import JuryOverview from "@/app/jury/[chapter-slug]/page";
import AdminDetail from "@/app/admin/(dashboard)/submissions/[id]/page";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const challenge = toChallenge({ id: "challenge", title: "Challenge", chapter_id: "chapter", submission_fields: [
  { key: "backend", label: "Backend", type: "repo", required: true },
  { key: "frontend", label: "Frontend", type: "repo", required: true },
] });
function setSubmission(overrides: Record<string, unknown> = {}) {
  const submission = toSubmission({
    id: "submission", challenge_id: "challenge", team_id: "team", project_name: "Project",
    fields: { backend: "https://github.com/team/backend", frontend: "https://github.com/team/frontend" },
    submission_revision: 1, submitted_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
    repo_snapshots: {
      backend: { repo_url: "https://github.com/team/backend", repository_id: 1, frozen_sha: sha, entire_required: false, checkpoint_manifest: [] },
      frontend: { repo_url: "https://github.com/team/frontend", repository_id: 2, frozen_sha: otherSha, entire_required: false, checkpoint_manifest: [] },
    },
    ...overrides,
  });
  mocks.getSubmissionById.mockResolvedValue(submission);
  mocks.getSubmissionsForChallengeAuthenticated.mockResolvedValue([submission]);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "juror" } });
  mocks.getChapterBySlug.mockResolvedValue({ id: "chapter", name: "Local event" });
  mocks.resolveJuryAssignment.mockResolvedValue({ challengeId: "challenge", status: "pending" });
  mocks.getChallengeById.mockResolvedValue(challenge);
  mocks.getTeams.mockResolvedValue([{ id: "team", name: "Team" }]);
  mocks.getCodeReviewForSubmissionAuthenticated.mockResolvedValue(null);
  mocks.getPitchOrder.mockResolvedValue(null);
  setSubmission();
});

const pages = [
  ["jury detail", () => JuryDetail({ params: Promise.resolve({ "chapter-slug": "event", id: "submission" }), searchParams: Promise.resolve({}) })],
  ["jury overview", () => JuryOverview({ params: Promise.resolve({ "chapter-slug": "event" }), searchParams: Promise.resolve({}) })],
  ["admin detail", () => AdminDetail({ params: Promise.resolve({ id: "submission" }) })],
] as const;

describe.each(pages)("%s accepted repository links", (_name, render) => {
  it("pins each repository to its own accepted commit before copying", async () => {
    const html = renderToStaticMarkup(await render());
    expect(html).toContain(`href="https://github.com/team/backend/tree/${sha}"`);
    expect(html).toContain(`href="https://github.com/team/frontend/tree/${otherSha}"`);
    expect(html).not.toContain('href="https://github.com/team/backend"');
    expect(html).not.toContain('href="https://github.com/team/frontend"');
  });

  it("uses the primary fork only for its matching repository", async () => {
    setSubmission({ fork_url: "https://github.com/snapshots/copy", snapshot_sha: sha });
    const html = renderToStaticMarkup(await render());
    expect(html).toContain(`href="https://github.com/snapshots/copy/tree/${sha}"`);
    expect(html).toContain(`href="https://github.com/team/frontend/tree/${otherSha}"`);
    expect(html).not.toContain('href="https://github.com/snapshots/copy"');
  });

  it("shows an unavailable message instead of a mutable link for a broken new receipt", async () => {
    setSubmission({ repo_snapshots: {} });
    const html = renderToStaticMarkup(await render());
    expect(html).toContain("Accepted repository version unavailable.");
    expect(html).not.toContain('href="https://github.com/team/backend"');
    expect(html).not.toContain('href="https://github.com/team/frontend"');
  });

  it("retains original links for historical submissions", async () => {
    setSubmission({ submission_revision: 0, repo_snapshots: {} });
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('href="https://github.com/team/backend"');
    expect(html).toContain('href="https://github.com/team/frontend"');
  });
});
