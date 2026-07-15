import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Boundary tests for the admin certificate-design API: global-admin gate,
// MIME/size validation (react-pdf can only draw PNG/JPEG), and that uploads
// land in the PRIVATE bucket with an upserted DB row.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getActingUserId: vi.fn(),
  createAdminClient: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: mocks.requireAdmin,
  getActingUserId: mocks.getActingUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/event-log", () => ({ logEvent: mocks.logEvent }));

import { GET, POST, DELETE } from "@/app/api/admin/chapters/[id]/certificate-design/route";

const CHAPTER = "11111111-1111-1111-1111-111111111111";

function params() {
  return { params: Promise.resolve({ id: CHAPTER }) };
}

function makeDb(opts: { chapterExists?: boolean; designPath?: string | null } = {}) {
  const upload = vi.fn(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const download = vi.fn(async () =>
    opts.designPath
      ? { data: new Blob([Buffer.from("img")], { type: "image/png" }), error: null }
      : { data: null, error: { message: "not found" } }
  );
  const upsert = vi.fn(async () => ({ error: null }));
  const del = vi.fn(() => {
    const chain = {
      eq: vi.fn(() => chain),
      then: (onF: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(onF),
    };
    return chain;
  });
  const createBucket = vi.fn(async () => ({ error: null }));

  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.single = () => {
        if (table === "chapters") {
          return Promise.resolve(
            opts.chapterExists === false ? { data: null } : { data: { id: CHAPTER } }
          );
        }
        if (table === "chapter_certificate_designs") {
          return Promise.resolve(
            opts.designPath
              ? { data: { storage_path: opts.designPath } }
              : { data: null }
          );
        }
        return Promise.resolve({ data: null });
      };
      builder.upsert = upsert;
      builder.delete = del;
      return builder;
    },
    storage: {
      createBucket,
      from: vi.fn(() => ({ upload, remove, download })),
    },
  };
  return { db, upload, remove, download, upsert, createBucket };
}

// Minimal headers that satisfy the magic-byte AND dimension checks (the
// route reads width/height from the PNG IHDR / JPEG SOF header).
function pngBytes(width = 2384, height = 1684): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(26);
  const view = new DataView(arr.buffer);
  arr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // signature
  view.setUint32(8, 13); // IHDR length
  arr.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return arr;
}
function jpegBytes(width = 2384, height = 1684): Uint8Array<ArrayBuffer> {
  // FFD8 + SOF0 segment carrying the frame dimensions.
  const arr = new Uint8Array(13);
  const view = new DataView(arr.buffer);
  arr.set([0xff, 0xd8, 0xff, 0xc0]);
  view.setUint16(4, 9); // segment length
  arr[6] = 8; // precision
  view.setUint16(7, height);
  view.setUint16(9, width);
  return arr;
}
const PNG_BYTES = pngBytes();
const JPEG_BYTES = jpegBytes();

function uploadRequest(opts: { variant?: string; file?: File | null } = {}) {
  const formData = new FormData();
  formData.append("variant", opts.variant ?? "participation");
  if (opts.file !== null) {
    formData.append(
      "file",
      opts.file ?? new File([PNG_BYTES], "design.png", { type: "image/png" })
    );
  }
  return new Request(`http://t/api/admin/chapters/${CHAPTER}/certificate-design`, {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(null);
  mocks.getActingUserId.mockResolvedValue("admin-id");
  mocks.createAdminClient.mockReturnValue(makeDb().db);
});

describe("POST /api/admin/chapters/[id]/certificate-design", () => {
  it("non-admin => 403 (guard response passed through)", async () => {
    mocks.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );
    const res = await POST(uploadRequest(), params());
    expect(res.status).toBe(403);
  });

  it("invalid variant => 400", async () => {
    const res = await POST(uploadRequest({ variant: "gold" }), params());
    expect(res.status).toBe(400);
  });

  it("missing file => 400", async () => {
    const res = await POST(uploadRequest({ file: null }), params());
    expect(res.status).toBe(400);
  });

  it("rejects non-PNG/JPEG uploads (WebP would break react-pdf) => 400", async () => {
    const file = new File([Buffer.from("x")], "d.webp", { type: "image/webp" });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("rejects SVG uploads => 400", async () => {
    const file = new File([Buffer.from("<svg/>")], "d.svg", { type: "image/svg+xml" });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("rejects files over 5MB => 400", async () => {
    const file = new File([Buffer.alloc(5 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("rejects a non-A4-landscape design (would shift values off the field lines) => 400", async () => {
    // 16:9 export: stretched full-bleed it would move every printed underline.
    const file = new File([pngBytes(1920, 1080)], "wide.png", { type: "image/png" });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("rejects a portrait design => 400", async () => {
    const file = new File([jpegBytes(1684, 2384)], "portrait.jpg", { type: "image/jpeg" });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("rejects a PNG whose header is too short to carry dimensions => 400", async () => {
    const file = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], "trunc.png", {
      type: "image/png",
    });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("rejects a file whose content does not match the declared MIME (spoofed PNG) => 400", async () => {
    // A renamed WebP arrives with type image/png (browsers derive it from the
    // extension); react-pdf could not decode it, so the content check must catch it.
    const file = new File([Buffer.from("RIFFxxxxWEBPVP8 ")], "spoofed.png", {
      type: "image/png",
    });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(400);
  });

  it("accepts a real JPEG under the declared image/jpeg type", async () => {
    const { db, upload } = makeDb();
    mocks.createAdminClient.mockReturnValue(db);
    const file = new File([JPEG_BYTES], "design.jpg", { type: "image/jpeg" });
    const res = await POST(uploadRequest({ file }), params());
    expect(res.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(
      `${CHAPTER}/participation.jpg`,
      expect.anything(),
      expect.objectContaining({ contentType: "image/jpeg" })
    );
  });

  it("unknown chapter => 404", async () => {
    mocks.createAdminClient.mockReturnValue(makeDb({ chapterExists: false }).db);
    const res = await POST(uploadRequest(), params());
    expect(res.status).toBe(404);
  });

  it("valid upload creates a PRIVATE bucket, stores the file and upserts the row", async () => {
    const { db, upload, upsert, createBucket } = makeDb();
    mocks.createAdminClient.mockReturnValue(db);

    const res = await POST(uploadRequest(), params());
    expect(res.status).toBe(200);
    expect(createBucket).toHaveBeenCalledWith("certificate-backgrounds", {
      public: false,
    });
    expect(upload).toHaveBeenCalledWith(
      `${CHAPTER}/participation.png`,
      expect.anything(),
      expect.objectContaining({ contentType: "image/png", upsert: true })
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: CHAPTER,
        variant: "participation",
        storage_path: `${CHAPTER}/participation.png`,
      }),
      { onConflict: "chapter_id,variant" }
    );
  });
});

describe("GET /api/admin/chapters/[id]/certificate-design (preview)", () => {
  it("non-admin => 403", async () => {
    mocks.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );
    const res = await GET(
      new Request(`http://t/x?variant=participation`),
      params()
    );
    expect(res.status).toBe(403);
  });

  it("no design uploaded => 404", async () => {
    const res = await GET(
      new Request(`http://t/x?variant=participation`),
      params()
    );
    expect(res.status).toBe(404);
  });

  it("streams the stored image when a design exists", async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDb({ designPath: `${CHAPTER}/participation.png` }).db
    );
    const res = await GET(
      new Request(`http://t/x?variant=participation`),
      params()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});

describe("DELETE /api/admin/chapters/[id]/certificate-design", () => {
  it("non-admin => 403", async () => {
    mocks.requireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Admin access required" }, { status: 403 })
    );
    const res = await DELETE(
      new Request(`http://t/x?variant=participation`, { method: "DELETE" }),
      params()
    );
    expect(res.status).toBe(403);
  });

  it("invalid variant => 400", async () => {
    const res = await DELETE(
      new Request(`http://t/x?variant=nope`, { method: "DELETE" }),
      params()
    );
    expect(res.status).toBe(400);
  });

  it("removes the row and the stored files", async () => {
    const { db, remove } = makeDb({ designPath: `${CHAPTER}/participation.png` });
    mocks.createAdminClient.mockReturnValue(db);
    const res = await DELETE(
      new Request(`http://t/x?variant=participation`, { method: "DELETE" }),
      params()
    );
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith([
      `${CHAPTER}/participation.png`,
      `${CHAPTER}/participation.jpg`,
    ]);
  });
});
