import { afterEach, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  downloadCapturedArchive,
  readRepositoryZip,
} from "@/lib/code-review/archive";
import { ingestRepo } from "@/lib/code-review/ingest";
vi.mock("@/lib/settings", () => ({
  getSettingValue: vi.fn(async () => "test-token"),
  SETTING_KEYS: { GITHUB_TOKEN: "github_token" },
}));
const sha = "a".repeat(40);
function archive() {
  return zipSync({
    "repo/index.ts": strToU8("export const value = 1;"),
    "repo/README.md": strToU8("# Example"),
  });
}
afterEach(() => vi.unstubAllGlobals());

it("reviews the saved commit with one archive request and no per-file calls", async () => {
  const request = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(new Uint8Array(archive()).buffer),
  );
  vi.stubGlobal("fetch", request);
  const result = await ingestRepo(
    "https://github.com/example/project",
    50000,
    sha,
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0][0])).toBe(
    `https://api.github.com/repos/example/project/zipball/${sha}`,
  );
  expect(result.files).toEqual(
    expect.arrayContaining([
      { path: "index.ts", content: "export const value = 1;" },
    ]),
  );
});
it("does not forward the API token to the archive download host", async () => {
  const api = {
    request: vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://codeload.github.com/example/project/zip/example",
          },
        }),
    ),
  };
  const download = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(new Uint8Array(archive()).buffer),
  );
  vi.stubGlobal("fetch", download);
  expect(
    (
      await downloadCapturedArchive(
        api,
        "https://github.com/example/project",
        sha,
      )
    ).get("index.ts"),
  ).toBe("export const value = 1;");
  expect(download).toHaveBeenCalledTimes(1);
  expect(download.mock.calls[0][1]).not.toHaveProperty("headers");
});
it("rejects archive redirects outside GitHub", async () => {
  const api = {
    request: vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/private" },
        }),
    ),
  };
  const download = vi.fn();
  vi.stubGlobal("fetch", download);
  await expect(
    downloadCapturedArchive(api, "https://github.com/example/project", sha),
  ).rejects.toThrow("Unexpected archive redirect");
  expect(download).not.toHaveBeenCalled();
});
it("rejects paths that could escape the archive root", () => {
  expect(() =>
    readRepositoryZip(zipSync({ "repo/../secret": strToU8("unsafe") })),
  ).toThrow("Unsafe archive path");
});
it("omits binary and oversized files from review text", () => {
  const result = readRepositoryZip(
    zipSync({
      "repo/a.bin": new Uint8Array([0, 1]),
      "repo/huge.txt": strToU8("a".repeat(50001)),
      "repo/safe.txt": strToU8("ok"),
    }),
  );
  expect([...result]).toEqual([["safe.txt", "ok"]]);
});
