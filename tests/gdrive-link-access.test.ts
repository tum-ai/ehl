import { describe, it, expect, vi, beforeEach } from "vitest";

// makeFileLinkReadable grants "anyone with link" read access. This is the
// security-relevant behavior (submission artifacts must be jury-viewable, but
// CVs/admin uploads must NOT get this). We mock googleapis and assert the exact
// permission requested, and that it targets the given fileId on a shared drive.
const permissionsCreate = vi.fn().mockResolvedValue({ data: { id: "perm-1" } });
const permissionsList = vi.fn().mockResolvedValue({ data: { permissions: [] } });

vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class { constructor() {} } },
    drive: () => ({
      permissions: { create: permissionsCreate, list: permissionsList },
    }),
  },
  drive_v3: {},
}));

import { makeFileLinkReadable, ensureFileLinkReadable } from "@/lib/gdrive";

beforeEach(() => {
  vi.clearAllMocks();
  permissionsList.mockResolvedValue({ data: { permissions: [] } });
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

describe("ensureFileLinkReadable", () => {
  it("grants access when the file is not yet link-readable", async () => {
    permissionsList.mockResolvedValueOnce({ data: { permissions: [] } });

    const ok = await ensureFileLinkReadable("file-1");

    expect(ok).toBe(true);
    expect(permissionsCreate).toHaveBeenCalledTimes(1);
    expect(permissionsCreate.mock.calls[0][0].fileId).toBe("file-1");
  });

  it("is idempotent: skips the grant when anyone-reader already exists", async () => {
    permissionsList.mockResolvedValueOnce({
      data: { permissions: [{ type: "anyone", role: "reader" }] },
    });

    const ok = await ensureFileLinkReadable("file-2");

    expect(ok).toBe(true);
    expect(permissionsCreate).not.toHaveBeenCalled();
  });

  it("treats an existing anyone-writer permission as readable", async () => {
    permissionsList.mockResolvedValueOnce({
      data: { permissions: [{ type: "anyone", role: "writer" }] },
    });

    const ok = await ensureFileLinkReadable("file-3");

    expect(ok).toBe(true);
    expect(permissionsCreate).not.toHaveBeenCalled();
  });

  it("does not treat a non-anyone permission as link-readable", async () => {
    permissionsList.mockResolvedValueOnce({
      data: { permissions: [{ type: "user", role: "reader" }] },
    });

    const ok = await ensureFileLinkReadable("file-4");

    expect(ok).toBe(true);
    expect(permissionsCreate).toHaveBeenCalledTimes(1);
  });

  it("never throws: returns false when Drive is unreachable (view must not 500)", async () => {
    permissionsList.mockRejectedValueOnce(new Error("drive down"));

    const ok = await ensureFileLinkReadable("file-5");

    expect(ok).toBe(false);
  });

  it("returns false when listing succeeds but the grant fails", async () => {
    permissionsList.mockResolvedValueOnce({ data: { permissions: [] } });
    permissionsCreate.mockRejectedValueOnce(new Error("grant failed"));

    const ok = await ensureFileLinkReadable("file-6");

    expect(ok).toBe(false);
  });
});
