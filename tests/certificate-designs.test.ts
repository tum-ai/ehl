import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCertificateBackgroundDataUri } from "@/lib/certificates/designs";

// The custom-background loader must NEVER throw: a certificate link in
// someone's inbox must keep working (falling back to the default EHL design)
// even when the design row or its storage object is broken.

function makeClient(opts: {
  designPath?: string | null;
  downloadError?: boolean;
  queryThrows?: boolean;
}): SupabaseClient {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.single = () => {
        if (opts.queryThrows) return Promise.reject(new Error("db down"));
        return Promise.resolve(
          opts.designPath ? { data: { storage_path: opts.designPath } } : { data: null }
        );
      };
      return builder;
    },
    storage: {
      from: vi.fn(() => ({
        download: async () =>
          opts.downloadError
            ? { data: null, error: { message: "object not found" } }
            : {
                data: new Blob([Buffer.from("fake-image-bytes")], { type: "image/png" }),
                error: null,
              },
      })),
    },
  } as unknown as SupabaseClient;
}

describe("getCertificateBackgroundDataUri", () => {
  it("returns a data URI when the design and its file exist", async () => {
    const uri = await getCertificateBackgroundDataUri(
      makeClient({ designPath: "chapter/participation.png" }),
      "chapter",
      "participation"
    );
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(uri).toContain(Buffer.from("fake-image-bytes").toString("base64"));
  });

  it("returns null when no design row exists", async () => {
    const uri = await getCertificateBackgroundDataUri(
      makeClient({ designPath: null }),
      "chapter",
      "participation"
    );
    expect(uri).toBeNull();
  });

  it("returns null (no throw) when the storage object is missing", async () => {
    const uri = await getCertificateBackgroundDataUri(
      makeClient({ designPath: "chapter/participation.png", downloadError: true }),
      "chapter",
      "participation"
    );
    expect(uri).toBeNull();
  });

  it("returns null (no throw) when the design query itself fails", async () => {
    const uri = await getCertificateBackgroundDataUri(
      makeClient({ queryThrows: true }),
      "chapter",
      "participation"
    );
    expect(uri).toBeNull();
  });
});
