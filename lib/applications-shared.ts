import type { ApplicationTeamMember } from "@/lib/types";

// Builds the `applications` row payload from the submitted form. Extracted so the
// normal apply flow (submitApplication) and the walk-in flow
// (submitWalkInApplication in lib/actions/walk-in.ts) construct the row from a
// single source of truth and can never drift (form_data shape, team-member
// parsing, consent columns). The caller supplies the already-validated chapter,
// names, and email; status / existing_team_id / cv_url remain the caller's to
// set, since those differ between the two flows.
//
// This lives OUTSIDE the "use server" action files on purpose: it is a pure
// synchronous helper, and Next.js requires every export from a "use server"
// module to be an async Server Action. Keeping it here lets both action files
// import it without violating that rule.
export function buildApplicationInsert(
  formData: FormData,
  opts: { chapterId: string; firstName: string; lastName: string; email: string }
) {
  const formDataJson = {
    dateOfBirth: formData.get("dateOfBirth") || null,
    gender: formData.get("gender") || null,
    nationality: formData.get("nationality") || null,
    city: formData.get("locationCity") || null,
    country: formData.get("locationCountry") || null,
    currentlyStudying: formData.get("currentlyStudying") === "true",
    university: formData.get("university") || null,
    degree: formData.get("degree") || null,
    fieldOfStudy: formData.get("fieldOfStudy") || null,
    graduationDate: formData.get("graduationDate") || null,
    hasProgrammingSkills: formData.get("hasProgrammingSkills") === "true",
    isTumaiMember: formData.get("isTumaiMember") === "true",
    hackathonExperience: formData.get("hackathonExperience") || "",
    linkedIn: formData.get("linkedIn") || null,
    github: formData.get("github") || null,
    website: formData.get("website") || null,
    hasTeam: formData.get("hasTeam") === "true",
    dietaryRestrictions: formData.get("dietaryRestrictions") || "None",
    dietaryRestrictionsOther: formData.get("dietaryRestrictionsOther") || null,
    tshirtCut: formData.get("tshirtCut") || "men's",
    tshirtSize: formData.get("tshirtSize") || "M",
    discoverySource: JSON.parse((formData.get("discoverySource") as string) || "[]"),
    discoverySourceOther: formData.get("discoverySourceOther") || null,
    additionalNotes: formData.get("additionalNotes") || null,
  };

  const teamMembers: ApplicationTeamMember[] = [];
  for (let i = 0; i < 4; i++) {
    const memberFirst = formData.get(`teamMemberFirstName${i}`) as string;
    const memberLast = formData.get(`teamMemberLastName${i}`) as string;
    const memberEmail = formData.get(`teamMemberEmail${i}`) as string;
    if (memberFirst && memberLast && memberEmail) {
      teamMembers.push({
        firstName: memberFirst.trim(),
        lastName: memberLast.trim(),
        email: memberEmail.trim().toLowerCase(),
      });
    }
  }

  return {
    chapter_id: opts.chapterId,
    email: opts.email,
    first_name: opts.firstName,
    last_name: opts.lastName,
    form_data: formDataJson,
    cv_url: null as string | null,
    team_members: teamMembers,
    consent_attendance: formData.get("consentAttendance") === "true",
    consent_privacy: formData.get("consentPrivacy") === "true",
    consent_newsletter: formData.get("consentNewsletter") === "true",
    consent_recruiting: formData.get("consentRecruiting") === "true",
    consent_media: formData.get("consentMedia") === "true",
    consent_ip_transfer: formData.get("consentIpTransfer") === "true",
    consent_sponsor_data: formData.get("consentSponsorData") === "true",
  };
}
