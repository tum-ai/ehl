import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for the "wrong challenge shown" bug: a juror invited to TWO
// challenges in the same chapter clicked one challenge but saw the other,
// because every layer resolved the assignment by chapter alone
// (`assignments.find(a => a.chapterId === chapter.id)`) and so always returned
// the FIRST challenge in the chapter. resolveJuryAssignment disambiguates by
// the clicked challenge id while preserving the chapter-first fallback for the
// single-challenge case and legacy links.
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { resolveJuryAssignment } from "@/lib/queries/jury";

const USER = "juror-1";
const CHAPTER = "chapter-1";
const OTHER_CHAPTER = "chapter-2";
const CHALLENGE_A = "challenge-a";
const CHALLENGE_B = "challenge-b";

function row(challengeId: string, chapterId: string, status = "pending") {
  return {
    user_id: USER,
    challenge_id: challengeId,
    chapter_id: chapterId,
    status,
    assigned_at: "2026-06-01T00:00:00Z",
  };
}

// Mock the `.from(...).select(...).eq("user_id", userId)` chain used by
// getJuryAssignmentsForUser, returning the configured rows.
function mockAssignments(rows: Array<ReturnType<typeof row>>) {
  mocks.createClient.mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveJuryAssignment", () => {
  it("returns the requested challenge, not the first one in the chapter", async () => {
    // Two challenges in the same chapter; A is first in the list.
    mockAssignments([
      row(CHALLENGE_A, CHAPTER),
      row(CHALLENGE_B, CHAPTER),
    ]);

    // Clicking the SECOND challenge must resolve to the second challenge.
    const resolved = await resolveJuryAssignment(USER, CHAPTER, CHALLENGE_B);
    expect(resolved?.challengeId).toBe(CHALLENGE_B);
  });

  it("returns the first assignment when no challenge id is given (single-challenge / legacy)", async () => {
    mockAssignments([
      row(CHALLENGE_A, CHAPTER),
      row(CHALLENGE_B, CHAPTER),
    ]);

    const resolved = await resolveJuryAssignment(USER, CHAPTER);
    expect(resolved?.challengeId).toBe(CHALLENGE_A);
  });

  it("returns null when the juror is not assigned to the requested challenge", async () => {
    // Juror only has challenge A in this chapter; cannot view B.
    mockAssignments([row(CHALLENGE_A, CHAPTER)]);

    const resolved = await resolveJuryAssignment(USER, CHAPTER, CHALLENGE_B);
    expect(resolved).toBeNull();
  });

  it("returns null when the juror has no assignment in the chapter", async () => {
    mockAssignments([row(CHALLENGE_A, OTHER_CHAPTER)]);

    const resolved = await resolveJuryAssignment(USER, CHAPTER, CHALLENGE_A);
    expect(resolved).toBeNull();
  });

  it("ignores assignments from other chapters when a challenge id is given", async () => {
    // Same challenge id should never leak across chapters: a juror assigned to
    // CHALLENGE_A only in OTHER_CHAPTER must not resolve it under CHAPTER.
    mockAssignments([
      row(CHALLENGE_A, OTHER_CHAPTER),
      row(CHALLENGE_B, CHAPTER),
    ]);

    const resolved = await resolveJuryAssignment(USER, CHAPTER, CHALLENGE_A);
    expect(resolved).toBeNull();
  });
});
