// Capability tokens for public certificate links.
//
// The certificate PDF route (`/api/certificates/[chapterId]/[teamId]`) is linked
// in emails sent to participants, who are NOT necessarily logged in when they
// click. chapterId and teamId are UUIDs but must be treated as guessable /
// enumerable for a security boundary: an unauthenticated route keyed only on
// them would let anyone enumerate every team's certificate (which contains
// member names — PII).
//
// Instead, the emailed URL carries a stateless HMAC capability token bound to
// the exact (chapterId, teamId) pair. The route recomputes the expected token
// and compares it in constant time. A valid token authorizes ONLY that one
// certificate; it reveals nothing about any other team. No database row or
// migration is needed (stateless), and tokens stay valid as long as the secret
// is stable.
//
// Secret: CERTIFICATE_LINK_SECRET, falling back to VERIFICATION_ENCRYPTION_KEY
// (an existing server-side secret). We fail closed if neither is configured so a
// token can never be generated or accepted under an empty/predictable key.

function getTokenKey(): Buffer {
  const secret =
    process.env.CERTIFICATE_LINK_SECRET || process.env.VERIFICATION_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "CERTIFICATE_LINK_SECRET (or VERIFICATION_ENCRYPTION_KEY) environment variable is required"
    );
  }
  const { createHash } = require("crypto") as typeof import("crypto");
  // Derive a fixed-length key from the secret, mirroring lib/crypto.ts. We
  // namespace with a label so this key cannot collide with any other use of the
  // same secret (e.g. AES password encryption in lib/crypto.ts).
  return createHash("sha256").update(`certificate-link:${secret}`).digest();
}

/**
 * Compute the capability token for a (chapterId, teamId) certificate.
 * Returns a URL-safe base64 (base64url) string.
 */
export function certificateToken(chapterId: string, teamId: string): string {
  const { createHmac } = require("crypto") as typeof import("crypto");
  const key = getTokenKey();
  // Bind the token to BOTH ids with an unambiguous separator. The ids are UUIDs
  // (no colons), so `${chapterId}:${teamId}` cannot be made to collide with a
  // different pair by shifting bytes across the boundary.
  const mac = createHmac("sha256", key).update(`${chapterId}:${teamId}`).digest();
  return mac.toString("base64url");
}

/**
 * Constant-time verification that `token` is the valid capability token for the
 * given (chapterId, teamId). Returns false for any mismatch, malformed input, or
 * length difference. Never throws on attacker-controlled input.
 */
export function verifyCertificateToken(
  chapterId: string,
  teamId: string,
  token: string | null | undefined
): boolean {
  if (!token) return false;
  const { timingSafeEqual } = require("crypto") as typeof import("crypto");

  let provided: Buffer;
  try {
    provided = Buffer.from(token, "base64url");
  } catch {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(certificateToken(chapterId, teamId), "base64url");
  } catch {
    // Missing secret etc. Fail closed.
    return false;
  }

  // timingSafeEqual throws if lengths differ; guard first so length itself is
  // not an oracle-by-exception. A length mismatch is always a non-match.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
