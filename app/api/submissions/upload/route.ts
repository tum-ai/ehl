import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/actions/auth";
import { uploadFile, getViewLink, makeFileLinkReadable } from "@/lib/gdrive";
import { checkRateLimit, uploadLimiter } from "@/lib/ratelimit";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const ALLOWED_MIME_TYPES = new Set([
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "text/markdown",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // SVG intentionally excluded (XSS risk via embedded scripts)
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  // Video
  "video/mp4",
  "video/quicktime",
]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Rate limiting: 10 uploads per hour per user
  const rl = await checkRateLimit(uploadLimiter, session.user.id);
  if (rl.limited) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const teamId = formData.get("teamId") as string | null;
  const challengeId = formData.get("challengeId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!teamId || !challengeId) {
    return NextResponse.json({ error: "Team and challenge are required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File size must be under 20MB" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "File type not allowed. Please upload a document, image, archive, or video." },
      { status: 400 }
    );
  }

  // Verify the user belongs to this team (RLS: public read on team_members)
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", session.user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "You are not a member of this team" }, { status: 403 });
  }

  // Get team name for folder organization
  const { data: team } = await supabase
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .single();

  // Get challenge title for folder organization
  const { data: challenge } = await supabase
    .from("challenges")
    .select("title, chapter_id")
    .eq("id", challengeId)
    .single();

  const { data: chapter } = challenge?.chapter_id
    ? await supabase
        .from("chapters")
        .select("name")
        .eq("id", challenge.chapter_id)
        .single()
    : { data: null };

  try {
    const folderPath = [
      "Submissions",
      chapter?.name || "Unknown Chapter",
      team?.name || "Unknown Team",
    ];

    const result = await uploadFile(
      file,
      file.name,
      file.type || "application/octet-stream",
      folderPath
    );

    // Submission artifacts (e.g. pitch decks) are opened by the jury via an
    // embedded Drive preview, so they must be readable by anyone with the link.
    // uploadFile leaves files private (correct for CVs/admin uploads); we grant
    // link access here, scoped to submission files only.
    //
    // Best-effort: the file is already uploaded, so a transient grant failure
    // must NOT 500 the request (that would orphan the file and force a re-upload).
    // We log and proceed; scripts/backfill-submission-file-access.ts repairs any
    // file that was left private.
    try {
      await makeFileLinkReadable(result.fileId);
    } catch (permErr) {
      console.error(
        `Failed to grant link access to submission file ${result.fileId}; ` +
          "uploaded but private. Run backfill-submission-file-access to repair.",
        permErr
      );
    }

    return NextResponse.json({
      url: getViewLink(result.fileId),
      fileId: result.fileId,
      fileName: file.name,
    });
  } catch (err) {
    console.error("File upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
