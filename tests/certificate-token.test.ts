import { describe, it, expect, beforeAll } from "vitest";

// certificate-token.ts reads its secret at call time, so set it first.
beforeAll(() => {
  process.env.CERTIFICATE_LINK_SECRET = "test-cert-link-secret-do-not-use-in-prod";
  // Make sure the fallback can't accidentally satisfy the key when we delete the
  // primary secret in a later test.
  delete process.env.VERIFICATION_ENCRYPTION_KEY;
});

import {
  certificateToken,
  verifyCertificateToken,
  certificateTokenV2,
  verifyCertificateTokenV2,
} from "@/lib/certificate-token";

const CHAPTER_A = "11111111-1111-1111-1111-111111111111";
const TEAM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHAPTER_B = "22222222-2222-2222-2222-222222222222";
const TEAM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("certificateToken / verifyCertificateToken", () => {
  it("round-trips: a freshly generated token validates for its own pair", () => {
    const token = certificateToken(CHAPTER_A, TEAM_A);
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, token)).toBe(true);
  });

  it("is deterministic for the same pair (stateless, no nonce)", () => {
    expect(certificateToken(CHAPTER_A, TEAM_A)).toBe(
      certificateToken(CHAPTER_A, TEAM_A)
    );
  });

  it("is URL-safe base64url (no +, /, or = padding)", () => {
    const token = certificateToken(CHAPTER_A, TEAM_A);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces different tokens for different teams in the same chapter", () => {
    expect(certificateToken(CHAPTER_A, TEAM_A)).not.toBe(
      certificateToken(CHAPTER_A, TEAM_B)
    );
  });

  it("a token for team A does NOT validate for team B (no cross-team reuse)", () => {
    const tokenA = certificateToken(CHAPTER_A, TEAM_A);
    expect(verifyCertificateToken(CHAPTER_A, TEAM_B, tokenA)).toBe(false);
  });

  it("a token is bound to the chapter too (same team, different chapter fails)", () => {
    const tokenA = certificateToken(CHAPTER_A, TEAM_A);
    expect(verifyCertificateToken(CHAPTER_B, TEAM_A, tokenA)).toBe(false);
  });

  it("rejects a null / empty / missing token", () => {
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, null)).toBe(false);
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, undefined)).toBe(false);
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, "")).toBe(false);
  });

  it("rejects a tampered token (one flipped character)", () => {
    const token = certificateToken(CHAPTER_A, TEAM_A);
    const tampered =
      (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, tampered)).toBe(false);
  });

  it("rejects a token of the wrong length without throwing (length is not an oracle)", () => {
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, "short")).toBe(false);
    expect(
      verifyCertificateToken(CHAPTER_A, TEAM_A, "x".repeat(200))
    ).toBe(false);
  });

  it("rejects garbage / non-base64 input without throwing", () => {
    expect(() =>
      verifyCertificateToken(CHAPTER_A, TEAM_A, "!!!not base64!!!")
    ).not.toThrow();
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, "!!!not base64!!!")).toBe(
      false
    );
  });

  it("a token computed under a different secret does not validate", () => {
    const original = process.env.CERTIFICATE_LINK_SECRET;
    process.env.CERTIFICATE_LINK_SECRET = "a-completely-different-secret";
    const foreignToken = certificateToken(CHAPTER_A, TEAM_A);
    process.env.CERTIFICATE_LINK_SECRET = original;
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, foreignToken)).toBe(false);
  });

  it("falls back to VERIFICATION_ENCRYPTION_KEY when CERTIFICATE_LINK_SECRET is unset", () => {
    const saved = process.env.CERTIFICATE_LINK_SECRET;
    delete process.env.CERTIFICATE_LINK_SECRET;
    process.env.VERIFICATION_ENCRYPTION_KEY = "fallback-secret-for-test";
    try {
      const token = certificateToken(CHAPTER_A, TEAM_A);
      expect(verifyCertificateToken(CHAPTER_A, TEAM_A, token)).toBe(true);
    } finally {
      delete process.env.VERIFICATION_ENCRYPTION_KEY;
      process.env.CERTIFICATE_LINK_SECRET = saved;
    }
  });

  it("a v2 token never validates as a v1 token and vice versa", () => {
    const v2 = certificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" });
    expect(verifyCertificateToken(CHAPTER_A, TEAM_A, v2)).toBe(false);
    const v1 = certificateToken(CHAPTER_A, TEAM_A);
    expect(
      verifyCertificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" }, v1)
    ).toBe(false);
    expect(
      verifyCertificateTokenV2(CHAPTER_A, TEAM_A, { variant: "achievement" }, v1)
    ).toBe(false);
  });

  it("fails closed (throws on generate) when no secret is configured", () => {
    const savedCert = process.env.CERTIFICATE_LINK_SECRET;
    const savedVerif = process.env.VERIFICATION_ENCRYPTION_KEY;
    delete process.env.CERTIFICATE_LINK_SECRET;
    delete process.env.VERIFICATION_ENCRYPTION_KEY;
    try {
      expect(() => certificateToken(CHAPTER_A, TEAM_A)).toThrow(
        /CERTIFICATE_LINK_SECRET/
      );
      // verify never throws on attacker input, even with no secret: it returns false.
      expect(verifyCertificateToken(CHAPTER_A, TEAM_A, "anything")).toBe(false);
    } finally {
      process.env.CERTIFICATE_LINK_SECRET = savedCert;
      if (savedVerif !== undefined)
        process.env.VERIFICATION_ENCRYPTION_KEY = savedVerif;
    }
  });
});

const MEMBER_1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const MEMBER_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

describe("certificateTokenV2 / verifyCertificateTokenV2", () => {
  it("round-trips for a team-scoped variant token", () => {
    const token = certificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" });
    expect(
      verifyCertificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" }, token)
    ).toBe(true);
  });

  it("round-trips for a member-scoped token", () => {
    const token = certificateTokenV2(CHAPTER_A, TEAM_A, {
      variant: "achievement",
      memberId: MEMBER_1,
    });
    expect(
      verifyCertificateTokenV2(
        CHAPTER_A,
        TEAM_A,
        { variant: "achievement", memberId: MEMBER_1 },
        token
      )
    ).toBe(true);
  });

  it("is bound to the variant (participation token fails for achievement)", () => {
    const token = certificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" });
    expect(
      verifyCertificateTokenV2(CHAPTER_A, TEAM_A, { variant: "achievement" }, token)
    ).toBe(false);
  });

  it("is bound to the member (no cross-member reuse)", () => {
    const token = certificateTokenV2(CHAPTER_A, TEAM_A, {
      variant: "achievement",
      memberId: MEMBER_1,
    });
    expect(
      verifyCertificateTokenV2(
        CHAPTER_A,
        TEAM_A,
        { variant: "achievement", memberId: MEMBER_2 },
        token
      )
    ).toBe(false);
  });

  it("a member token does not validate as a team token (and vice versa)", () => {
    const memberToken = certificateTokenV2(CHAPTER_A, TEAM_A, {
      variant: "participation",
      memberId: MEMBER_1,
    });
    expect(
      verifyCertificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" }, memberToken)
    ).toBe(false);

    const teamToken = certificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" });
    expect(
      verifyCertificateTokenV2(
        CHAPTER_A,
        TEAM_A,
        { variant: "participation", memberId: MEMBER_1 },
        teamToken
      )
    ).toBe(false);
  });

  it("treats memberId null and undefined identically (both mean team scope)", () => {
    const withNull = certificateTokenV2(CHAPTER_A, TEAM_A, {
      variant: "participation",
      memberId: null,
    });
    const withUndefined = certificateTokenV2(CHAPTER_A, TEAM_A, {
      variant: "participation",
    });
    expect(withNull).toBe(withUndefined);
  });

  it("is bound to chapter and team like v1", () => {
    const token = certificateTokenV2(CHAPTER_A, TEAM_A, { variant: "participation" });
    expect(
      verifyCertificateTokenV2(CHAPTER_B, TEAM_A, { variant: "participation" }, token)
    ).toBe(false);
    expect(
      verifyCertificateTokenV2(CHAPTER_A, TEAM_B, { variant: "participation" }, token)
    ).toBe(false);
  });

  it("rejects null/empty/tampered tokens without throwing", () => {
    const scope = { variant: "participation" as const };
    expect(verifyCertificateTokenV2(CHAPTER_A, TEAM_A, scope, null)).toBe(false);
    expect(verifyCertificateTokenV2(CHAPTER_A, TEAM_A, scope, "")).toBe(false);
    const token = certificateTokenV2(CHAPTER_A, TEAM_A, scope);
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(verifyCertificateTokenV2(CHAPTER_A, TEAM_A, scope, tampered)).toBe(false);
  });
});
