import { afterEach, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => vi.fn(async (_key: string, fallback?: string) => fallback ?? null));
vi.mock("@/lib/settings", () => ({ getSettingValue: settings, SETTING_KEYS: { GITHUB_TOKEN: "github_token", GITHUB_ORG: "github_org" } }));
import { getGitHubConfiguration } from "@/lib/github";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("keeps the existing environment fallback for production credentials", async () => {
  vi.stubEnv("SNAPSHOT_WORKER_ENV", "production");
  vi.stubEnv("GITHUB_TOKEN", "example-production-token"); vi.stubEnv("GITHUB_ORG", "example-snapshots");
  expect(await getGitHubConfiguration()).toEqual({ token: "example-production-token", org: "example-snapshots" });
});
it("refuses a test worker without an explicit test organization", async () => {
  vi.stubEnv("SNAPSHOT_WORKER_ENV", "test"); vi.stubEnv("GITHUB_TOKEN", "example-test-token"); vi.stubEnv("GITHUB_ORG", "");
  await expect(getGitHubConfiguration()).rejects.toThrow("Test snapshots require explicit");
});
it("keeps test workers away from production defaults and database credentials", async () => {
  vi.stubEnv("SNAPSHOT_WORKER_ENV", "test");
  vi.stubEnv("GITHUB_TOKEN", "example-test-token"); vi.stubEnv("GITHUB_ORG", "example-test-snapshots");
  expect(await getGitHubConfiguration()).toEqual({ token: "example-test-token", org: "example-test-snapshots" });
  expect(settings).not.toHaveBeenCalled();
});
