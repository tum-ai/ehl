import { describe, it, expect } from "vitest";
import {
  hasSponsorConsent,
  rowHasSponsorConsent,
  rankingSupportsPodium,
  SPONSOR_CONSENT_OR_FILTER,
} from "@/lib/showcase-shared";

// The partner showcase exposes applicant profiles + CVs to sponsors behind an
// unguessable link. WHO appears is gated by a single consent predicate, shared
// by the public list and the CV proxy so a person hidden from the list can never
// have their CV fetched. This test pins that predicate down.
//
// Semantics (established from the application form): one optional, default-off
// checkbox drives both consent_sponsor_data and consent_recruiting. We OR them
// because consent_sponsor_data only exists from migration 00034 onward, so a
// pre-00034 applicant who ticked the box has consent_recruiting=true but
// consent_sponsor_data=false. The OR recovers those legitimately-consented rows.

describe("hasSponsorConsent (showcase visibility gate)", () => {
  it("shows an applicant who opted into sponsor sharing", () => {
    expect(hasSponsorConsent({ consentSponsorData: true, consentRecruiting: false })).toBe(true);
  });

  it("shows a pre-00034 applicant who only has consent_recruiting (legacy opt-in)", () => {
    expect(hasSponsorConsent({ consentSponsorData: false, consentRecruiting: true })).toBe(true);
  });

  it("hides an applicant who opted into neither", () => {
    expect(hasSponsorConsent({ consentSponsorData: false, consentRecruiting: false })).toBe(false);
  });

  it("treats null/undefined consent as no consent (fails closed)", () => {
    expect(hasSponsorConsent({})).toBe(false);
    expect(hasSponsorConsent({ consentSponsorData: null, consentRecruiting: null })).toBe(false);
  });

  it("never gates on consent_privacy (which is hardcoded true for everyone)", () => {
    // consent_privacy is set true on every application, so it must NOT appear in
    // the predicate — otherwise every applicant would be exposed. Guard against a
    // future refactor accidentally OR-ing it in.
    const src = hasSponsorConsent.toString();
    expect(src).not.toMatch(/privacy/i);
  });

  it("the SQL filter is EXACTLY the OR of the same two consent columns", () => {
    // Pinned with toBe, not toContain: a refactor that wrapped the fragments in
    // and(...) or appended a third condition would pass a substring check while
    // silently changing the gate's semantics (e.g. hiding pre-00034 legacy
    // opt-ins). Supabase's .or() ORs exactly this comma-separated list.
    expect(SPONSOR_CONSENT_OR_FILTER).toBe(
      "consent_sponsor_data.eq.true,consent_recruiting.eq.true"
    );
  });
});

describe("rowHasSponsorConsent (raw snake_case row adapter)", () => {
  it("matches hasSponsorConsent semantics on raw rows", () => {
    expect(rowHasSponsorConsent({ consent_sponsor_data: true, consent_recruiting: false })).toBe(true);
    expect(rowHasSponsorConsent({ consent_sponsor_data: false, consent_recruiting: true })).toBe(true);
    expect(rowHasSponsorConsent({ consent_sponsor_data: false, consent_recruiting: false })).toBe(false);
  });

  it("fails closed on missing/null columns", () => {
    expect(rowHasSponsorConsent({})).toBe(false);
    expect(rowHasSponsorConsent({ consent_sponsor_data: null, consent_recruiting: null })).toBe(false);
  });
});

// ─── rankingSupportsPodium() ────────────────────────────────

describe("rankingSupportsPodium (duplicate-placement regression)", () => {
  it("allows the podium for a single-challenge chapter (unique 1-2-3)", () => {
    expect(
      rankingSupportsPodium([{ placement: 1 }, { placement: 2 }, { placement: 3 }])
    ).toBe(true);
  });

  it("REFUSES the podium when two challenges both have a 1st place", () => {
    // Placements are per challenge: a 2-challenge chapter has two placement=1
    // rows. A podium keyed by placement would silently drop one WINNING team
    // from the sponsor-facing ranking — the exact bug this helper prevents.
    expect(
      rankingSupportsPodium([
        { placement: 1 }, // challenge A winner
        { placement: 1 }, // challenge B winner
        { placement: 2 },
      ])
    ).toBe(false);
  });

  it("refuses the podium when there are no placed rows", () => {
    expect(rankingSupportsPodium([])).toBe(false);
    expect(rankingSupportsPodium([{ placement: null }])).toBe(false);
  });

  it("ignores 4th/5th duplicates (they render as a list either way)", () => {
    expect(
      rankingSupportsPodium([
        { placement: 1 },
        { placement: 2 },
        { placement: 3 },
        { placement: 4 },
        { placement: 4 },
      ])
    ).toBe(true);
  });
});

// ─── buildTeamNameByEmail() ─────────────────────────────────

import { buildTeamNameByEmail } from "@/lib/showcase-shared";

describe("buildTeamNameByEmail (applicant -> event team)", () => {
  it("maps roster members to their team via profile email, lowercased", () => {
    const map = buildTeamNameByEmail(
      [
        { teamName: "Alpha", roster: ["u1", "u2"] },
        { teamName: "Beta", roster: ["u3"] },
      ],
      [
        { id: "u1", email: "Ada@Example.com" },
        { id: "u2", email: "alan@example.com" },
        { id: "u3", email: "grace@example.com" },
      ]
    );
    expect(map.get("ada@example.com")).toBe("Alpha");
    expect(map.get("alan@example.com")).toBe("Alpha");
    expect(map.get("grace@example.com")).toBe("Beta");
  });

  it("ignores profiles not on any roster and roster ids without a profile", () => {
    const map = buildTeamNameByEmail(
      [{ teamName: "Alpha", roster: ["u1", "ghost-user"] }],
      [
        { id: "u1", email: "ada@example.com" },
        { id: "u9", email: "bystander@example.com" },
      ]
    );
    expect(map.get("ada@example.com")).toBe("Alpha");
    expect(map.has("bystander@example.com")).toBe(false);
    expect(map.size).toBe(1);
  });

  it("skips profiles without an email (no crash, no bogus key)", () => {
    const map = buildTeamNameByEmail(
      [{ teamName: "Alpha", roster: ["u1"] }],
      [{ id: "u1", email: null }]
    );
    expect(map.size).toBe(0);
  });
});
