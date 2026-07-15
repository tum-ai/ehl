import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, getActingUserId } from "@/lib/admin-auth";
import { logEvent } from "@/lib/event-log";
import {
  CERTIFICATE_BACKGROUNDS_BUCKET,
  CERTIFICATE_BACKGROUND_MAX_BYTES,
  CERTIFICATE_BACKGROUND_MIME_TO_EXT,
  certificateBackgroundPath,
  downloadCertificateBackground,
} from "@/lib/certificates/designs";
import type { CertificateVariant } from "@/lib/certificate-token";
import { isValidBackgroundAspect } from "@/lib/certificates/layout";

// Custom certificate background designs for one chapter (certificates v2,
// Stage 1). GLOBAL admin only: designs are chapter settings, which local
// chapter admins cannot edit (requireAdmin admits only role "admin").

function parseVariant(value: unknown): CertificateVariant | null {
  return value === "participation" || value === "achievement" ? value : null;
}

/**
 * Verify the file content actually matches the declared image type. Browsers
 * derive file.type from the extension, so a renamed WebP arrives as image/png;
 * react-pdf cannot decode it and every certificate render for the chapter
 * would fail. Magic bytes: PNG 89 50 4E 47, JPEG FF D8 FF.
 */
function matchesMagicBytes(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return false;
}

/**
 * Read the pixel dimensions from a PNG IHDR / JPEG SOF header (no decoder
 * needed). Returns null when the header cannot be parsed, which is treated as
 * an invalid upload: the image is stretched full-bleed under fixed value
 * positions, so we must be able to check its aspect ratio.
 */
function readImageDimensions(
  bytes: Uint8Array,
  mime: string
): { width: number; height: number } | null {
  const u32 = (o: number) =>
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const u16 = (o: number) => (bytes[o] << 8) | bytes[o + 1];
  if (mime === "image/png") {
    // Signature (8) + IHDR chunk: length(4) + "IHDR"(4) + width(4) + height(4)
    if (bytes.length < 24) return null;
    return { width: u32(16), height: u32(20) };
  }
  if (mime === "image/jpeg") {
    // Walk the JPEG segments to the first SOF marker (C0-CF except C4/C8/CC).
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16(offset + 7), height: u16(offset + 5) };
      }
      offset += 2 + u16(offset + 2);
    }
    return null;
  }
  return null;
}

/** All storage paths a design for this variant may live at (both allowed
 * extensions), so replace/delete never leaves a stale file behind. */
function allVariantPaths(chapterId: string, variant: CertificateVariant): string[] {
  return Object.values(CERTIFICATE_BACKGROUND_MIME_TO_EXT).map((ext) =>
    certificateBackgroundPath(chapterId, variant, ext)
  );
}

/** Preview: stream the uploaded background image (the bucket is private, so
 * the admin UI cannot use a public URL). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id: chapterId } = await params;
  const variant = parseVariant(new URL(request.url).searchParams.get("variant"));
  if (!variant) {
    return NextResponse.json({ error: "Invalid variant." }, { status: 400 });
  }

  const background = await downloadCertificateBackground(
    createAdminClient(),
    chapterId,
    variant
  );
  if (!background) {
    return NextResponse.json({ error: "No design uploaded." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(background.buffer), {
    headers: {
      "Content-Type": background.mime,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id: chapterId } = await params;
  const formData = await request.formData();
  const variant = parseVariant(formData.get("variant"));
  const file = formData.get("file") as File | null;

  if (!variant) {
    return NextResponse.json({ error: "Invalid variant." }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  // Stricter than the general image whitelist: react-pdf can only draw
  // PNG/JPEG (no WebP/AVIF, and SVG is banned repo-wide).
  const ext = CERTIFICATE_BACKGROUND_MIME_TO_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG and JPEG images are allowed for certificate designs." },
      { status: 400 }
    );
  }
  if (file.size > CERTIFICATE_BACKGROUND_MAX_BYTES) {
    return NextResponse.json({ error: "File size must be under 5MB." }, { status: 400 });
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesMagicBytes(fileBytes, file.type)) {
    return NextResponse.json(
      { error: "File content does not match its declared image type. Upload a real PNG or JPEG." },
      { status: 400 }
    );
  }

  // The design is stretched full-bleed under FIXED value positions: any
  // non-A4-landscape aspect would silently shift the design's printed field
  // lines away from where the values are drawn. Reject it here, with a clear
  // message, instead of producing misaligned certificates.
  const dimensions = readImageDimensions(fileBytes, file.type);
  if (!dimensions || !isValidBackgroundAspect(dimensions.width, dimensions.height)) {
    return NextResponse.json(
      {
        error:
          "The design must be A4 landscape (aspect ratio 1.41:1, e.g. 2384x1684 px). Other formats would shift the certificate text off the design's field lines.",
      },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // The chapter must exist (also guards against uploading under a bogus id).
  const { data: chapter } = await adminClient
    .from("chapters")
    .select("id")
    .eq("id", chapterId)
    .single();
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found." }, { status: 404 });
  }

  // Lazily create the PRIVATE bucket (designs must not be publicly enumerable).
  const { error: bucketError } = await adminClient.storage.createBucket(
    CERTIFICATE_BACKGROUNDS_BUCKET,
    { public: false }
  );
  if (bucketError && !bucketError.message.includes("already exists")) {
    console.error("Certificate design bucket creation failed:", bucketError.message);
    return NextResponse.json({ error: "Storage setup failed." }, { status: 500 });
  }

  // Replace any previous design for this variant, including one stored under
  // the other extension (a leftover would shadow nothing but waste storage).
  const stalePaths = allVariantPaths(chapterId, variant).filter(
    (p) => p !== certificateBackgroundPath(chapterId, variant, ext)
  );
  if (stalePaths.length > 0) {
    await adminClient.storage.from(CERTIFICATE_BACKGROUNDS_BUCKET).remove(stalePaths);
  }

  const storagePath = certificateBackgroundPath(chapterId, variant, ext);
  const { error: uploadError } = await adminClient.storage
    .from(CERTIFICATE_BACKGROUNDS_BUCKET)
    .upload(storagePath, fileBytes, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    console.error("Certificate design upload failed:", uploadError.message);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const actorId = await getActingUserId();
  const { error: dbError } = await adminClient
    .from("chapter_certificate_designs")
    .upsert(
      {
        chapter_id: chapterId,
        variant,
        storage_path: storagePath,
        uploaded_by: actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chapter_id,variant" }
    );

  if (dbError) {
    console.error("Certificate design row upsert failed:", dbError.message);
    return NextResponse.json({ error: "Saving the design failed." }, { status: 500 });
  }

  logEvent({
    action: "chapter.certificate_design_uploaded",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { created: { variant, storage_path: storagePath } },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id: chapterId } = await params;
  const variant = parseVariant(new URL(request.url).searchParams.get("variant"));
  if (!variant) {
    return NextResponse.json({ error: "Invalid variant." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { error: dbError } = await adminClient
    .from("chapter_certificate_designs")
    .delete()
    .eq("chapter_id", chapterId)
    .eq("variant", variant);

  if (dbError) {
    return NextResponse.json({ error: "Removing the design failed." }, { status: 500 });
  }

  // Best-effort: certificates already fall back to the default design when the
  // storage object is gone, so a failed removal only wastes storage.
  await adminClient.storage
    .from(CERTIFICATE_BACKGROUNDS_BUCKET)
    .remove(allVariantPaths(chapterId, variant));

  const actorId = await getActingUserId();
  logEvent({
    action: "chapter.certificate_design_removed",
    entityType: "chapter",
    entityId: chapterId,
    actorId,
    actorType: "admin",
    delta: { deleted: { variant } },
  });

  return NextResponse.json({ success: true });
}
