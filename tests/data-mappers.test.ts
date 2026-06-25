import { describe, it, expect } from "vitest";
import {
  toTeam,
  toChapter,
  toChapterCommunications,
  toScore,
  toChallenge,
  toSubmission,
  toProfile,
  toApplication,
  toApplicationNote,
  toTeamMember,
  toPitchOrder,
  toJuryRanking,
  toScreeningScore,
  toJoinRequest,
} from "@/lib/queries";

// ─── toTeam ─────────────────────────────────────────────────

describe("toTeam", () => {
  it("maps a full row correctly", () => {
    const row = {
      id: "t1",
      name: "TUM.ai",
      slug: "tum-ai",
      logo_url: "https://example.com/logo.png",
      university: "TU Munich",
      city: "Munich",
      president_user_id: "u1",
      looking_for_members: false,
    };
    const team = toTeam(row);
    expect(team).toEqual({
      id: "t1",
      name: "TUM.ai",
      slug: "tum-ai",
      logoUrl: "https://example.com/logo.png",
      university: "TU Munich",
      city: "Munich",
      presidentUserId: "u1",
      lookingForMembers: false,
    });
  });

  it("defaults nullable fields to null", () => {
    const row = {
      id: "t1",
      name: "TestTeam",
      slug: "test",
    };
    const team = toTeam(row);
    expect(team.logoUrl).toBeNull();
    expect(team.university).toBeNull();
    expect(team.city).toBeNull();
    expect(team.presidentUserId).toBeNull();
  });
});

// ─── toChapter ──────────────────────────────────────────────

describe("toChapter", () => {
  it("maps a full row correctly", () => {
    const row = {
      id: "c1",
      name: "Match 1",
      slug: "match-1",
      city: "Munich",
      country: "Germany",
      country_code: "DE",
      date: "2026-05-15",
      date_end: "2026-05-16",
      status: "completed",
      description: "Test",
      hero_image_url: "https://img.com/hero.jpg",
      match_number: 1,
      is_finale: false,
      submission_deadline: "2026-05-15T18:00:00",
      code_review_enabled: true,
      photo_album_url: "https://photos.com/album",
      challenge_registration_enabled: true,
    };
    const chapter = toChapter(row);
    expect(chapter.id).toBe("c1");
    expect(chapter.codeReviewEnabled).toBe(true);
    expect(chapter.challengeRegistrationEnabled).toBe(true);
    expect(chapter.photoAlbumUrl).toBe("https://photos.com/album");
  });

  it("defaults codeReviewEnabled to false when null", () => {
    const row = {
      id: "c1", name: "Test", slug: "test", city: "X", country: "X",
      country_code: "XX", status: "draft", description: "", match_number: 1,
      is_finale: false,
    };
    const chapter = toChapter(row);
    expect(chapter.codeReviewEnabled).toBe(false);
    expect(chapter.challengeRegistrationEnabled).toBe(false);
    expect(chapter.date).toBeNull();
    expect(chapter.dateEnd).toBeNull();
    expect(chapter.heroImageUrl).toBeNull();
    expect(chapter.submissionDeadline).toBeNull();
    expect(chapter.photoAlbumUrl).toBeNull();
  });
});

describe("toChapterCommunications", () => {
  it("maps a full row correctly", () => {
    const comms = toChapterCommunications({
      chapter_id: "c1",
      acceptance_email_subject: "Custom subject",
      acceptance_email_message: "See you in Munich!",
      event_info: "Discord: https://discord.gg/x",
    });
    expect(comms.acceptanceEmailSubject).toBe("Custom subject");
    expect(comms.acceptanceEmailMessage).toBe("See you in Munich!");
    expect(comms.eventInfo).toBe("Discord: https://discord.gg/x");
  });

  it("defaults all fields to null when absent", () => {
    const comms = toChapterCommunications({ chapter_id: "c1" });
    expect(comms.acceptanceEmailSubject).toBeNull();
    expect(comms.acceptanceEmailMessage).toBeNull();
    expect(comms.eventInfo).toBeNull();
  });
});

// ─── toScore ────────────────────────────────────────────────

describe("toScore", () => {
  it("maps a full row correctly", () => {
    const row = {
      chapter_id: "c1",
      team_id: "t1",
      challenge_name: "AI for Good",
      challenge_id: "ch1",
      placement: 1,
      points: 8,
      source: "jury",
    };
    const score = toScore(row);
    expect(score.placement).toBe(1);
    expect(score.points).toBe(8);
    expect(score.source).toBe("jury");
  });

  it("defaults placement to null", () => {
    const row = {
      chapter_id: "c1", team_id: "t1", challenge_name: "Test",
      points: 2,
    };
    const score = toScore(row);
    expect(score.placement).toBeNull();
    expect(score.challengeId).toBeNull();
    expect(score.source).toBe("admin_override"); // default
  });
});

// ─── toChallenge ────────────────────────────────────────────

describe("toChallenge", () => {
  it("defaults submissionFields to empty array", () => {
    const row = {
      id: "ch1", chapter_id: "c1", title: "Test Challenge",
    };
    const challenge = toChallenge(row);
    expect(challenge.submissionFields).toEqual([]);
    expect(challenge.codeReviewEnabled).toBe(false);
    expect(challenge.entireRequired).toBe(false);
    expect(challenge.pitchDurationMinutes).toBe(3);
    expect(challenge.displayOrder).toBe(0);
  });

  it("maps entire_required when set", () => {
    const challenge = toChallenge({
      id: "ch1", chapter_id: "c1", title: "T", entire_required: true,
    });
    expect(challenge.entireRequired).toBe(true);
  });

  it("preserves submissionFields when provided", () => {
    const fields = [{ key: "repo", label: "GitHub URL", type: "url", required: true }];
    const row = {
      id: "ch1", chapter_id: "c1", title: "Test",
      submission_fields: fields,
      code_review_enabled: true,
      pitch_duration_minutes: 5,
      display_order: 2,
    };
    const challenge = toChallenge(row);
    expect(challenge.submissionFields).toEqual(fields);
    expect(challenge.codeReviewEnabled).toBe(true);
    expect(challenge.pitchDurationMinutes).toBe(5);
    expect(challenge.displayOrder).toBe(2);
  });

  it("defaults all nullable text fields to null", () => {
    const row = { id: "ch1", chapter_id: "c1", title: "T" };
    const challenge = toChallenge(row);
    expect(challenge.description).toBeNull();
    expect(challenge.sponsorName).toBeNull();
    expect(challenge.sponsorLogoUrl).toBeNull();
    expect(challenge.prizeDescription).toBeNull();
    expect(challenge.judgingCriteria).toBeNull();
  });

  it("defaults juryFinalizedAt to null when absent", () => {
    // The publish-readiness gate depends on this field to know whether a scored
    // challenge's jury results have been materialized into scores. Absent -> null
    // (not finalized).
    const challenge = toChallenge({ id: "ch1", chapter_id: "c1", title: "T" });
    expect(challenge.juryFinalizedAt).toBeNull();
  });

  it("maps jury_finalized_at when set", () => {
    const ts = "2026-06-24T10:00:00.000Z";
    const challenge = toChallenge({
      id: "ch1", chapter_id: "c1", title: "T", jury_finalized_at: ts,
    });
    expect(challenge.juryFinalizedAt).toBe(ts);
  });
});

// ─── toSubmission ───────────────────────────────────────────

describe("toSubmission", () => {
  it("defaults fields to empty object and techStack to empty array", () => {
    const row = {
      id: "s1", challenge_id: "ch1", team_id: "t1",
      project_name: "Test Project",
      submitted_at: "2026-05-15T10:00:00",
      updated_at: "2026-05-15T10:00:00",
      is_locked: false,
    };
    const submission = toSubmission(row);
    expect(submission.fields).toEqual({});
    expect(submission.techStack).toEqual([]);
    expect(submission.shortDescription).toBeNull();
  });

  it("preserves fields and techStack when provided", () => {
    const row = {
      id: "s1", challenge_id: "ch1", team_id: "t1",
      project_name: "AI Bot",
      short_description: "A chatbot",
      fields: { repo: "https://github.com/test/repo" },
      tech_stack: ["React", "Python", "OpenAI"],
      submitted_at: "2026-05-15",
      updated_at: "2026-05-15",
      is_locked: true,
    };
    const submission = toSubmission(row);
    expect(submission.fields).toEqual({ repo: "https://github.com/test/repo" });
    expect(submission.techStack).toEqual(["React", "Python", "OpenAI"]);
    expect(submission.isLocked).toBe(true);
  });
});

// ─── toProfile ──────────────────────────────────────────────

describe("toProfile", () => {
  it("defaults role to participant when null", () => {
    const row = { id: "u1" };
    const profile = toProfile(row);
    expect(profile.role).toBe("participant");
    expect(profile.name).toBeNull();
    expect(profile.email).toBeNull();
  });

  it("preserves role when set", () => {
    const row = { id: "u1", name: "Admin", email: "admin@example.com", role: "admin" };
    const profile = toProfile(row);
    expect(profile.role).toBe("admin");
    expect(profile.name).toBe("Admin");
    expect(profile.email).toBe("admin@example.com");
  });
});

// ─── toApplication ──────────────────────────────────────────

describe("toApplication", () => {
  it("defaults formData to empty object", () => {
    const row = {
      id: "a1", chapter_id: "c1", email: "test@example.com",
      first_name: "John", last_name: "Doe", status: "pending",
      check_in_token: "tok123",
      consent_attendance: true, consent_privacy: true,
      created_at: "2026-05-01", updated_at: "2026-05-01",
    };
    const app = toApplication(row);
    expect(app.formData).toEqual({});
    expect(app.teamMembers).toEqual([]);
    expect(app.cvUrl).toBeNull();
    expect(app.existingTeamId).toBeNull();
    expect(app.checkedInAt).toBeNull();
    expect(app.checkedInBy).toBeNull();
    expect(app.consentNewsletter).toBe(false);
    expect(app.consentRecruiting).toBe(false);
    expect(app.consentMedia).toBe(false);
    expect(app.consentIpTransfer).toBe(false);
    expect(app.consentSponsorData).toBe(false);
    expect(app.acceptanceEmailSentAt).toBeNull();
    expect(app.rejectionEmailSentAt).toBeNull();
    expect(app.cancelledAt).toBeNull();
    expect(app.cancelledBy).toBeNull();
    expect(app.cancelReason).toBeNull();
  });

  it("maps cancellation metadata for a cancelled application", () => {
    const row = {
      id: "a1", chapter_id: "c1", email: "test@example.com",
      first_name: "John", last_name: "Doe", status: "cancelled",
      check_in_token: "tok123",
      consent_attendance: true, consent_privacy: true,
      created_at: "2026-05-01", updated_at: "2026-06-01",
      cancelled_at: "2026-06-01T09:00:00", cancelled_by: "admin-1",
      cancel_reason: "emailed they cannot attend",
    };
    const app = toApplication(row);
    expect(app.status).toBe("cancelled");
    expect(app.cancelledAt).toBe("2026-06-01T09:00:00");
    expect(app.cancelledBy).toBe("admin-1");
    expect(app.cancelReason).toBe("emailed they cannot attend");
  });

  it("preserves consent flags when true", () => {
    const row = {
      id: "a1", chapter_id: "c1", email: "test@example.com",
      first_name: "John", last_name: "Doe", status: "accepted",
      check_in_token: "tok123",
      consent_attendance: true, consent_privacy: true,
      consent_newsletter: true, consent_recruiting: true,
      consent_media: true, consent_ip_transfer: true, consent_sponsor_data: true,
      created_at: "2026-05-01", updated_at: "2026-05-01",
      acceptance_email_sent_at: "2026-05-02T10:00:00",
    };
    const app = toApplication(row);
    expect(app.consentNewsletter).toBe(true);
    expect(app.consentRecruiting).toBe(true);
    expect(app.consentMedia).toBe(true);
    expect(app.consentIpTransfer).toBe(true);
    expect(app.consentSponsorData).toBe(true);
    expect(app.acceptanceEmailSentAt).toBe("2026-05-02T10:00:00");
  });
});

// ─── toApplicationNote ──────────────────────────────────────

describe("toApplicationNote", () => {
  it("maps all fields and defaults author info to null", () => {
    const note = toApplicationNote({
      id: "n1",
      application_id: "a1",
      body: "called him, will confirm tomorrow",
      created_at: "2026-06-01T09:00:00",
    });
    expect(note).toEqual({
      id: "n1",
      applicationId: "a1",
      authorId: null,
      authorEmail: null,
      body: "called him, will confirm tomorrow",
      createdAt: "2026-06-01T09:00:00",
    });
  });

  it("preserves author info when present", () => {
    const note = toApplicationNote({
      id: "n2",
      application_id: "a1",
      author_id: "admin-1",
      author_email: "admin@tum-ai.com",
      body: "cancelled",
      created_at: "2026-06-01T10:00:00",
    });
    expect(note.authorId).toBe("admin-1");
    expect(note.authorEmail).toBe("admin@tum-ai.com");
  });
});

// ─── toTeamMember ───────────────────────────────────────────

describe("toTeamMember", () => {
  it("maps all fields directly (no null defaults)", () => {
    const row = {
      team_id: "t1",
      user_id: "u1",
      role: "president",
      joined_at: "2026-05-01T10:00:00",
    };
    const member = toTeamMember(row);
    expect(member).toEqual({
      teamId: "t1",
      userId: "u1",
      role: "president",
      joinedAt: "2026-05-01T10:00:00",
    });
  });

  it("handles member role", () => {
    const row = {
      team_id: "t1",
      user_id: "u2",
      role: "member",
      joined_at: "2026-05-01",
    };
    expect(toTeamMember(row).role).toBe("member");
  });
});

// ─── toPitchOrder ───────────────────────────────────────────

describe("toPitchOrder", () => {
  it("defaults orderList to empty array when null", () => {
    const row = {
      challenge_id: "ch1",
      generated_at: "2026-05-15",
    };
    const order = toPitchOrder(row);
    expect(order.orderList).toEqual([]);
    expect(order.generatedBy).toBeNull();
  });

  it("preserves orderList when provided", () => {
    const row = {
      challenge_id: "ch1",
      order_list: ["t1", "t3", "t2"],
      generated_at: "2026-05-15",
      generated_by: "admin1",
    };
    const order = toPitchOrder(row);
    expect(order.orderList).toEqual(["t1", "t3", "t2"]);
    expect(order.generatedBy).toBe("admin1");
  });
});

// ─── toJuryRanking ──────────────────────────────────────────

describe("toJuryRanking", () => {
  it("maps ranking record correctly", () => {
    const row = {
      id: "jr1",
      challenge_id: "ch1",
      entered_by: "jury1",
      ranking: { "1": "t1", "2": "t2", "3": "t3" },
      submitted_at: "2026-05-15",
      is_final: true,
    };
    const ranking = toJuryRanking(row);
    expect(ranking.ranking).toEqual({ "1": "t1", "2": "t2", "3": "t3" });
    expect(ranking.isFinal).toBe(true);
  });
});

// ─── toScreeningScore ───────────────────────────────────────

describe("toScreeningScore", () => {
  it("maps with notes", () => {
    const row = {
      id: "ss1",
      application_id: "a1",
      screener_id: "admin1",
      score: 8,
      notes: "Strong candidate",
      created_at: "2026-05-15",
    };
    const ss = toScreeningScore(row);
    expect(ss.score).toBe(8);
    expect(ss.notes).toBe("Strong candidate");
  });

  it("defaults notes to null", () => {
    const row = {
      id: "ss1",
      application_id: "a1",
      screener_id: "admin1",
      score: 5,
      created_at: "2026-05-15",
    };
    const ss = toScreeningScore(row);
    expect(ss.notes).toBeNull();
  });
});

// ─── toJoinRequest ──────────────────────────────────────────

describe("toJoinRequest", () => {
  it("maps a pending join request", () => {
    const row = {
      id: "jr1",
      team_id: "t1",
      user_id: "u1",
      chapter_id: "c1",
      status: "pending",
      created_at: "2026-05-15",
    };
    const jr = toJoinRequest(row);
    expect(jr.status).toBe("pending");
    expect(jr.resolvedAt).toBeNull();
    expect(jr.resolvedBy).toBeNull();
  });

  it("maps a resolved join request", () => {
    const row = {
      id: "jr1",
      team_id: "t1",
      user_id: "u1",
      chapter_id: "c1",
      status: "approved",
      created_at: "2026-05-15",
      resolved_at: "2026-05-15T14:00:00",
      resolved_by: "president1",
    };
    const jr = toJoinRequest(row);
    expect(jr.status).toBe("approved");
    expect(jr.resolvedAt).toBe("2026-05-15T14:00:00");
    expect(jr.resolvedBy).toBe("president1");
  });
});
