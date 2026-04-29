// Password encryption for temporary storage in verification_codes.
// Passwords must not be stored in plaintext. We encrypt with AES-256-GCM
// using a server-side key before storing, and decrypt only at verification time.

function getEncryptionKey(): Buffer {
  const secret = process.env.VERIFICATION_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("VERIFICATION_ENCRYPTION_KEY environment variable is required");
  }
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(secret).digest();
}

export function encryptPassword(plaintext: string): string {
  const { createCipheriv, randomBytes } = require("crypto") as typeof import("crypto");
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Return as base64: iv:tag:ciphertext
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptPassword(encoded: string): string {
  const { createDecipheriv } = require("crypto") as typeof import("crypto");
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

/** Generate a cryptographically secure 6-digit verification code. */
export function generateVerificationCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (100000 + (buf[0] % 900000)).toString();
}
