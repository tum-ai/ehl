import type { SupabaseClient } from "@supabase/supabase-js";
import type { CertificateVariant } from "@/lib/certificate-token";

// Custom certificate background designs (Package 2 / Stage 1).
//
// Admins upload one PNG/JPEG background per chapter and per variant; the
// certificate route draws it full-bleed under the fixed-position text layout
// (lib/certificates/layout.ts). The bucket is PRIVATE: designs may carry
// sponsor branding that must not be enumerable before an event, so the image
// only ever reaches a client embedded in an authorized certificate PDF or via
// the admin-guarded preview endpoint.

export const CERTIFICATE_BACKGROUNDS_BUCKET = "certificate-backgrounds";

/** Only formats @react-pdf/renderer's <Image> can draw. No SVG (XSS rule), and
 * no WebP/AVIF (react-pdf cannot decode them). */
export const CERTIFICATE_BACKGROUND_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export const CERTIFICATE_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;

export function certificateBackgroundPath(
  chapterId: string,
  variant: CertificateVariant,
  ext: string
): string {
  return `${chapterId}/${variant}.${ext}`;
}

function mimeFromPath(path: string): string {
  return path.endsWith(".png") ? "image/png" : "image/jpeg";
}

/**
 * Look up and download the custom background for (chapterId, variant), or null
 * when none exists (no design row, or its storage object is gone). Shared by
 * the certificate route (via the cached data-URI wrapper below) and the admin
 * preview endpoint so the lookup/download/mime logic cannot drift.
 */
export async function downloadCertificateBackground(
  adminClient: SupabaseClient,
  chapterId: string,
  variant: CertificateVariant
): Promise<{ buffer: Buffer; mime: string } | null> {
  const { data: design } = await adminClient
    .from("chapter_certificate_designs")
    .select("storage_path")
    .eq("chapter_id", chapterId)
    .eq("variant", variant)
    .single();

  if (!design?.storage_path) return null;

  const { data: blob, error } = await adminClient.storage
    .from(CERTIFICATE_BACKGROUNDS_BUCKET)
    .download(design.storage_path as string);

  if (error || !blob) {
    console.error(
      `Certificate background missing in storage (chapter ${chapterId}, ${variant}):`,
      error?.message
    );
    return null;
  }

  return {
    buffer: Buffer.from(await blob.arrayBuffer()),
    mime: blob.type || mimeFromPath(design.storage_path as string),
  };
}

// Per-instance cache of rendered data URIs. Certificate downloads burst (whole
// teams fetch up to three PDFs each right after publish), and re-downloading
// the same up-to-5MB background from storage for every render is pure waste.
// Short TTL so a replaced or deleted design propagates within a minute.
const CACHE_TTL_MS = 60_000;
const backgroundCache = new Map<string, { dataUri: string | null; expiresAt: number }>();

/** Test hook: reset the module-level background cache. */
export function clearCertificateBackgroundCache(): void {
  backgroundCache.clear();
}

/**
 * Load the custom background for (chapterId, variant) as a data URI for
 * react-pdf, or null when no design exists. NEVER throws: a certificate link
 * in someone's inbox must not break because a design row points at a deleted
 * storage object — any failure falls back to the default EHL design.
 */
export async function getCertificateBackgroundDataUri(
  adminClient: SupabaseClient,
  chapterId: string,
  variant: CertificateVariant
): Promise<string | null> {
  const cacheKey = `${chapterId}/${variant}`;
  const cached = backgroundCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.dataUri;

  let dataUri: string | null = null;
  try {
    const background = await downloadCertificateBackground(adminClient, chapterId, variant);
    if (background) {
      dataUri = `data:${background.mime};base64,${background.buffer.toString("base64")}`;
    }
  } catch (err) {
    console.error(
      `Failed to load certificate background (chapter ${chapterId}, ${variant}):`,
      err
    );
    // Fall through: cache the null so a broken design doesn't add a failing
    // roundtrip to every certificate render in the burst.
  }

  backgroundCache.set(cacheKey, { dataUri, expiresAt: Date.now() + CACHE_TTL_MS });
  return dataUri;
}
