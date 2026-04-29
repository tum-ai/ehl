import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/actions/auth";
import { uploadFile, getViewLink } from "@/lib/gdrive";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Buckets that stay in Supabase Storage (e.g. partner logos need direct public URLs for <img>)
const SUPABASE_BUCKETS = new Set(["partner-logos", "hero-images", "sponsor-logos"]);

// Only allow safe image types in public Supabase buckets (no SVG - XSS risk via <script>)
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const bucket = (formData.get("bucket") as string) || "uploads";
  const folder = (formData.get("folder") as string) || "Uploads";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File size must be under 20MB" }, { status: 400 });
  }

  // Partner logos stay in Supabase for direct public URLs
  if (SUPABASE_BUCKETS.has(bucket)) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, WebP, and AVIF images are allowed for this upload." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Ensure bucket exists (ignore "already exists" errors)
    const { error: bucketError } = await adminClient.storage.createBucket(bucket, { public: true });
    if (bucketError && !bucketError.message.includes("already exists")) {
      console.error("Bucket creation failed:", bucketError.message);
      return NextResponse.json({ error: `Storage setup failed: ${bucketError.message}` }, { status: 500 });
    }

    const ext = file.name.split(".").pop() || "bin";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error } = await adminClient.storage
      .from(bucket)
      .upload(filename, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("Storage upload failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: urlData } = adminClient.storage
      .from(bucket)
      .getPublicUrl(filename);

    return NextResponse.json({ url: urlData.publicUrl });
  }

  // Everything else goes to Google Drive
  try {
    const folderPath = folder.split("/").filter(Boolean);
    const result = await uploadFile(
      file,
      file.name,
      file.type || "application/octet-stream",
      folderPath
    );
    return NextResponse.json({
      url: getViewLink(result.fileId),
      fileId: result.fileId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
