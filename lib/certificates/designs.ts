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
  try {
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

    const buffer = Buffer.from(await blob.arrayBuffer());
    const mime = blob.type || mimeFromPath(design.storage_path as string);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error(
      `Failed to load certificate background (chapter ${chapterId}, ${variant}):`,
      err
    );
    return null;
  }
}
