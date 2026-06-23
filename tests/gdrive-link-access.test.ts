import { describe, it, expect, vi, beforeEach } from "vitest";

// makeFileLinkReadable grants "anyone with link" read access. This is the
// security-relevant behavior (submission artifacts must be jury-viewable, but
// CVs/admin uploads must NOT get this). We mock googleapis and assert the exact
// permission requested, and that it targets the given fileId on a shared drive.
const permissionsCreate = vi.fn().mockResolvedValue({ data: { id: "perm-1" } });

vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class { constructor() {} } },
    drive: () => ({ permissions: { create: permissionsCreate } }),
  },
  drive_v3: {},
}));

import { makeFileLinkReadable } from "@/lib/gdrive";

beforeEach(() => {
  vi.clearAllMocks();
  // getCredentials() needs this to be set (base64 of any JSON).
  process.env.GOOGLE_DRIVE_CREDENTIALS = Buffer.from('{"client_email":"x","private_key":"y"}').toString("base64");
});

describe("makeFileLinkReadable", () => {
  it("grants anyone-with-link READER access to the given file", async () => {
    await makeFileLinkReadable("file-123");

    expect(permissionsCreate).toHaveBeenCalledTimes(1);
    const arg = permissionsCreate.mock.calls[0][0];
    expect(arg.fileId).toBe("file-123");
    expect(arg.requestBody).toEqual({ role: "reader", type: "anyone" });
    // Shared Drive support is required for the EHL Drive.
    expect(arg.supportsAllDrives).toBe(true);
  });

  it("propagates Drive errors (caller decides how to handle)", async () => {
    permissionsCreate.mockRejectedValueOnce(new Error("drive down"));
    await expect(makeFileLinkReadable("file-x")).rejects.toThrow("drive down");
  });
});
