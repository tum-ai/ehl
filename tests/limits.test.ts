import { describe, it, expect, afterEach, vi } from "vitest";

// QUERY_LIMITS is evaluated once at module load, so each case sets the env var
// then imports a fresh copy of the module via resetModules + dynamic import.
async function loadLimitsWith(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return (await import("@/lib/config/limits")).QUERY_LIMITS;
}

afterEach(() => {
  delete process.env.LIMIT_TEAMS;
  vi.resetModules();
});

describe("QUERY_LIMITS envInt", () => {
  it("uses the fallback when the env var is unset", async () => {
    const limits = await loadLimitsWith({ LIMIT_TEAMS: undefined });
    expect(limits.teams).toBe(500);
  });

  it("parses a valid integer override", async () => {
    const limits = await loadLimitsWith({ LIMIT_TEAMS: "1234" });
    expect(limits.teams).toBe(1234);
  });

  it("falls back when the value is non-numeric", async () => {
    const limits = await loadLimitsWith({ LIMIT_TEAMS: "abc" });
    expect(limits.teams).toBe(500);
  });

  it("falls back on empty string", async () => {
    const limits = await loadLimitsWith({ LIMIT_TEAMS: "" });
    expect(limits.teams).toBe(500);
  });

  it("documents current behavior for '0' (parses to 0, which disables the query)", async () => {
    // Not necessarily desirable, but this is the current contract: an explicit
    // "0" override is honored. Captured so a future change is a deliberate one.
    const limits = await loadLimitsWith({ LIMIT_TEAMS: "0" });
    expect(limits.teams).toBe(0);
  });

  it("documents current behavior for a float (parseInt truncates)", async () => {
    const limits = await loadLimitsWith({ LIMIT_TEAMS: "1.9" });
    expect(limits.teams).toBe(1);
  });

  it("documents current behavior for a negative value (honored)", async () => {
    const limits = await loadLimitsWith({ LIMIT_TEAMS: "-5" });
    expect(limits.teams).toBe(-5);
  });
});
