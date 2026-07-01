import { describe, it, expect } from "vitest";
import { hasSponsorConsent, SPONSOR_CONSENT_OR_FILTER } from "@/lib/showcase-shared";

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

  it("the SQL filter ORs exactly the same two consent columns", () => {
    // The DB-level .or() filter and the in-code predicate must stay in lockstep.
    expect(SPONSOR_CONSENT_OR_FILTER).toContain("consent_sponsor_data.eq.true");
    expect(SPONSOR_CONSENT_OR_FILTER).toContain("consent_recruiting.eq.true");
    expect(SPONSOR_CONSENT_OR_FILTER).not.toMatch(/privacy|attendance|media|ip_transfer|newsletter/);
  });
});
