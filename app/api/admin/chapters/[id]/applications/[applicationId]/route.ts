import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApplicationFormData, ApplicationTeamMember } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; applicationId: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { applicationId } = await params;
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .single();

  if (!data) {
    return NextResponse.json(null, { status: 404 });
  }

  return NextResponse.json({
    id: data.id as string,
    chapterId: data.chapter_id as string,
    email: data.email as string,
    firstName: data.first_name as string,
    lastName: data.last_name as string,
    status: data.status as string,
    formData: (data.form_data as ApplicationFormData) ?? ({} as ApplicationFormData),
    cvUrl: (data.cv_url as string) ?? null,
    existingTeamId: (data.existing_team_id as string) ?? null,
    teamMembers: (data.team_members as ApplicationTeamMember[]) ?? [],
    checkInToken: data.check_in_token as string,
    checkedInAt: (data.checked_in_at as string) ?? null,
    checkedInBy: (data.checked_in_by as string) ?? null,
    consentAttendance: data.consent_attendance as boolean,
    consentPrivacy: data.consent_privacy as boolean,
    consentNewsletter: (data.consent_newsletter as boolean) ?? false,
    consentRecruiting: (data.consent_recruiting as boolean) ?? false,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    acceptanceEmailSentAt: (data.acceptance_email_sent_at as string) ?? null,
    rejectionEmailSentAt: (data.rejection_email_sent_at as string) ?? null,
  });
}
