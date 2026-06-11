import { describe, it, expect, beforeAll } from "vitest";

// crypto.ts reads VERIFICATION_ENCRYPTION_KEY at call time, so set it before
// importing/using the module.
beforeAll(() => {
  process.env.VERIFICATION_ENCRYPTION_KEY = "test-encryption-key-do-not-use-in-prod";
});

import {
  encryptPassword,
  decryptPassword,
  generateVerificationCode,
} from "@/lib/crypto";

describe("encryptPassword / decryptPassword", () => {
  it("round-trips a password", () => {
    const plain = "Sup3r-Secret!Pa$$word";
    const encrypted = encryptPassword(plain);
    expect(decryptPassword(encrypted)).toBe(plain);
  });

  it("round-trips unicode and empty strings", () => {
    expect(decryptPassword(encryptPassword(""))).toBe("");
    expect(decryptPassword(encryptPassword("pä$$wörd 🔐"))).toBe("pä$$wörd 🔐");
  });

  it("never stores plaintext (ciphertext does not contain the password)", () => {
    const plain = "PlaintextNeedle123";
    const encrypted = encryptPassword(plain);
    expect(encrypted).not.toContain(plain);
    // Format is iv:tag:ciphertext, all base64
    expect(encrypted.split(":")).toHaveLength(3);
  });

  it("uses a unique IV per call (same plaintext -> different ciphertext)", () => {
    const a = encryptPassword("samePassword");
    const b = encryptPassword("samePassword");
    expect(a).not.toBe(b);
    // ...but both decrypt back to the same value
    expect(decryptPassword(a)).toBe("samePassword");
    expect(decryptPassword(b)).toBe("samePassword");
  });

  it("throws on tampered ciphertext (GCM auth tag mismatch)", () => {
    const encrypted = encryptPassword("original");
    const [iv, tag, data] = encrypted.split(":");
    // Flip the ciphertext: re-base64 of mutated bytes
    const dataBuf = Buffer.from(data, "base64");
    dataBuf[0] = dataBuf[0] ^ 0xff;
    const tampered = `${iv}:${tag}:${dataBuf.toString("base64")}`;
    expect(() => decryptPassword(tampered)).toThrow();
  });

  it("throws when the encryption key is missing", () => {
    const saved = process.env.VERIFICATION_ENCRYPTION_KEY;
    delete process.env.VERIFICATION_ENCRYPTION_KEY;
    try {
      expect(() => encryptPassword("x")).toThrow(/VERIFICATION_ENCRYPTION_KEY/);
    } finally {
      process.env.VERIFICATION_ENCRYPTION_KEY = saved;
    }
  });
});

describe("generateVerificationCode", () => {
  it("returns a 6-digit numeric string", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
      const n = Number(code);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});
