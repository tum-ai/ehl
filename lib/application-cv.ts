import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadFile } from "@/lib/gdrive";
import { CV_MAX_BYTES, CV_MAX_LABEL } from "@/lib/config/upload-limits";

// CV handling shared by the apply flow (lib/actions/applications.ts) and the
// walk-in flow (lib/actions/walk-in.ts), so the two cannot drift.
//
// NOT a "use server" module on purpose: every export of one is a callable
// endpoint, and an uploader that takes an application id would let a client
// attach files to any application.

/**
 * Validates the optional CV on a submitted form BEFORE anything is written.
 * Returns the file to upload (or null when none was attached).
 *
 * The size check is defence in depth against a non-browser caller, NOT the
 * user-facing guard: a body over the platform limit never reaches the server
 * (see lib/config/upload-limits.ts).
 */
export function validateCv(
  formData: FormData
): { error: string } | { cvFile: File | null } {
  const cvFile = formData.get("cv") as File | null;
  if (!cvFile || cvFile.size === 0) return { cvFile: null };
  if (cvFile.size > CV_MAX_BYTES) {
    return { error: `CV file must be under ${CV_MAX_LABEL}.` };
  }
  const ext = cvFile.name.split(".").pop()?.toLowerCase();
  if (ext !== "pdf") {
    return { error: "CV must be a PDF file." };
  }
  return { cvFile };
}

/**
 * Uploads a validated CV and attaches it to an already-saved application.
 * Called AFTER the insert, so a Drive outage or hang can never lose the
 * application. Returns true when the upload failed (the caller tells the user).
 */
export async function attachCv(
  adminClient: SupabaseClient,
  opts: {
    applicationId: string;
    cvFile: File;
    chapterName: string;
    firstName: string;
    lastName: string;
  }
): Promise<{ cvUploadFailed: boolean }> {
  try {
    const folder = opts.chapterName.replace(/[^a-zA-Z0-9 ]/g, "");
    const fileName = `${opts.lastName}_${opts.firstName}_CV.pdf`;
    const result = await uploadFile(opts.cvFile, fileName, "application/pdf", ["CVs", folder]);
    await adminClient
      .from("applications")
      .update({ cv_url: result.fileId })
      .eq("id", opts.applicationId);
    return { cvUploadFailed: false };
  } catch (err) {
    console.error("CV upload error:", err);
    return { cvUploadFailed: true };
  }
}
