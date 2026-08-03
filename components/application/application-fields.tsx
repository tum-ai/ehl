"use client";

import { useState, useImperativeHandle, forwardRef } from "react";
import { Card } from "@/components/ui/card";
import { CV_MAX_LABEL } from "@/lib/config/upload-limits";

// ─── Shared application-field UI ─────────────────────────────
//
// The personal/academic/skills/team/logistics/CV/notes/consent fields are
// identical between the public apply form (components/application/application-form.tsx)
// and the event-day walk-in form (components/application/walk-in-form.tsx). They
// live here so neither flow drifts: both render <ApplicationFields/> and read the
// values back through the imperative ref (getMissingFields + populate).
//
// First/last name live here (they're application fields). Email lives in the
// parent: the apply form gates it behind an account-lookup card, the walk-in form
// pairs it with a password for account creation.

export interface ApplicationFieldsHandle {
  /** Required fields the user has not filled, by human label. */
  getMissingFields: (form: HTMLFormElement) => string[];
  /**
   * Write every field-owned value into the FormData about to be submitted,
   * including consents and (when applicable) existing_team_id.
   */
  populate: (formData: FormData) => void;
}

export interface ApplicationFieldsProps {
  userProfile?: {
    firstName: string;
    lastName: string;
    formData: Record<string, unknown>;
  } | null;
  /** A team matched to this person, offered as a "rejoin" option. */
  existingTeam?: { teamId: string; teamName: string } | null;
  /**
   * Walk-in: the CV is always optional (no "do you want to upload" gate), so the
   * field shows a plain optional file input. Apply: the user first answers a
   * required yes/no, then optionally uploads.
   */
  cvAlwaysOptional?: boolean;
}

const UNIVERSITIES = [
  "Technical University of Munich",
  "LMU Munich",
  "Munich University of Applied Sciences",
  "Technical University of Darmstadt",
  "Technical University of Berlin",
  "FAU Erlangen",
];

const FIELDS_OF_STUDY = [
  "Informatics",
  "Information Systems/ Business Informatics",
  "Data Science",
  "Business Administration",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Mathematics",
  "Physics",
];

const DISCOVERY_SOURCES = [
  "Friends",
  "LinkedIn",
  "TUM.ai Website",
  "University",
  "Instagram",
];

function InputField({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-text-muted">
        {label} {required && <span className="text-error">*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  required = false,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  required?: boolean;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-text-muted">
        {label} {required && <span className="text-error">*</span>}
      </label>
      <select
        name={name}
        required={required}
        value={value}
        onChange={onChange}
        className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary focus:border-purple focus:outline-none"
      >
        <option value="">Select...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RadioGroup({
  label,
  name,
  options,
  required = false,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  required?: boolean;
  value?: string;
  onChange?: (val: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-text-muted">
        {label} {required && <span className="text-error">*</span>}
      </label>
      <div className="mt-2 flex flex-wrap gap-3">
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-lg border px-4 py-2 text-sm transition-colors ${
              value === o.value
                ? "border-gold/40 bg-gold/10 text-gold"
                : "border-white/10 bg-surface-deep text-text-secondary hover:border-white/20"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange?.(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export const ApplicationFields = forwardRef<
  ApplicationFieldsHandle,
  ApplicationFieldsProps
>(function ApplicationFields(
  { userProfile, existingTeam, cvAlwaysOptional = false },
  ref
) {
  const [firstName, setFirstName] = useState(userProfile?.firstName ?? "");
  const [lastName, setLastName] = useState(userProfile?.lastName ?? "");
  const [gender, setGender] = useState((userProfile?.formData?.gender as string) ?? "");
  const [currentlyStudying, setCurrentlyStudying] = useState(
    userProfile?.formData?.currentlyStudying !== undefined
      ? String(userProfile.formData.currentlyStudying)
      : ""
  );
  const [university, setUniversity] = useState((userProfile?.formData?.university as string) ?? "");
  const [universityOther, setUniversityOther] = useState("");
  const [degree, setDegree] = useState((userProfile?.formData?.degree as string) ?? "");
  const [fieldOfStudy, setFieldOfStudy] = useState((userProfile?.formData?.fieldOfStudy as string) ?? "");
  const [fieldOfStudyOther, setFieldOfStudyOther] = useState("");
  const [hasProgrammingSkills, setHasProgrammingSkills] = useState(
    userProfile?.formData?.hasProgrammingSkills !== undefined
      ? String(userProfile.formData.hasProgrammingSkills)
      : ""
  );
  const [isTumaiMember, setIsTumaiMember] = useState(
    userProfile?.formData?.isTumaiMember !== undefined
      ? String(userProfile.formData.isTumaiMember)
      : ""
  );
  const [hasTeam, setHasTeam] = useState("");
  const [teamMemberCount, setTeamMemberCount] = useState(0);
  const [dietaryRestrictions, setDietaryRestrictions] = useState(
    (userProfile?.formData?.dietaryRestrictions as string) ?? ""
  );
  const [tshirtCut, setTshirtCut] = useState((userProfile?.formData?.tshirtCut as string) ?? "");
  const [tshirtSize, setTshirtSize] = useState((userProfile?.formData?.tshirtSize as string) ?? "");
  const [discoverySource, setDiscoverySource] = useState<string[]>(
    (userProfile?.formData?.discoverySource as string[]) ?? []
  );
  const [consentSharing, setConsentSharing] = useState(false);
  const [wantsCv, setWantsCv] = useState("");
  const [rejoinTeam, setRejoinTeam] = useState<boolean | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getMissingFields(form: HTMLFormElement): string[] {
        const missing: string[] = [];
        if (!firstName.trim()) missing.push("First Name");
        if (!lastName.trim()) missing.push("Last Name");
        const dob = (form.elements.namedItem("dateOfBirth") as HTMLInputElement)?.value;
        if (!dob) missing.push("Date of Birth");
        if (!gender) missing.push("Gender");
        const city = (form.elements.namedItem("locationCity") as HTMLInputElement)?.value;
        if (!city) missing.push("Current Location (City)");
        const country = (form.elements.namedItem("locationCountry") as HTMLInputElement)?.value;
        if (!country) missing.push("Country");
        const nationality = (form.elements.namedItem("nationality") as HTMLInputElement)?.value;
        if (!nationality) missing.push("Nationality");
        if (!currentlyStudying) missing.push("Currently Studying");
        if (currentlyStudying === "true") {
          if (!university) missing.push("University");
          if (university === "Other" && !universityOther.trim()) missing.push("University Name");
          if (!degree) missing.push("Degree");
          if (!fieldOfStudy) missing.push("Field of Study");
          if (fieldOfStudy === "Other" && !fieldOfStudyOther.trim()) missing.push("Field of Study Name");
        }
        if (!hasProgrammingSkills) missing.push("Programming Skills");
        if (!isTumaiMember) missing.push("TUM.ai Member");
        const experience = (form.elements.namedItem("hackathonExperience") as HTMLTextAreaElement)?.value;
        if (!experience?.trim()) missing.push("Hackathon Experience");
        if (!hasTeam) missing.push("Team Status");
        if (!dietaryRestrictions) missing.push("Dietary Restrictions");
        if (!tshirtCut) missing.push("T-Shirt Cut");
        if (!tshirtSize) missing.push("T-Shirt Size");
        if (discoverySource.length === 0) missing.push("How did you find out about us");
        if (!cvAlwaysOptional && !wantsCv) missing.push("CV Upload Decision");
        return missing;
      },
      populate(formData: FormData) {
        formData.set("firstName", firstName);
        formData.set("lastName", lastName);
        formData.set("dietaryRestrictions", dietaryRestrictions);
        formData.set("tshirtCut", tshirtCut);
        formData.set("tshirtSize", tshirtSize);
        // Required consents are implied by submitting (inline text, no checkbox).
        formData.set("consentAttendance", "true");
        formData.set("consentPrivacy", "true");
        formData.set("consentMedia", "true");
        formData.set("consentIpTransfer", "true");
        formData.set("consentNewsletter", consentSharing.toString());
        formData.set("consentRecruiting", consentSharing.toString());
        formData.set("consentSponsorData", consentSharing.toString());
        formData.set(
          "hasTeam",
          hasTeam === "existing" || hasTeam === "new_team" ? "true" : "false"
        );
        formData.set("gender", gender);
        formData.set("currentlyStudying", currentlyStudying);
        formData.set("university", university === "Other" ? universityOther : university);
        formData.set("degree", degree);
        formData.set("fieldOfStudy", fieldOfStudy === "Other" ? fieldOfStudyOther : fieldOfStudy);
        formData.set("hasProgrammingSkills", hasProgrammingSkills);
        formData.set("isTumaiMember", isTumaiMember);
        formData.set("discoverySource", JSON.stringify(discoverySource));
        if ((hasTeam === "existing" || rejoinTeam) && existingTeam) {
          formData.set("existingTeamId", existingTeam.teamId);
        }
      },
    }),
    [
      firstName,
      lastName,
      gender,
      currentlyStudying,
      university,
      universityOther,
      degree,
      fieldOfStudy,
      fieldOfStudyOther,
      hasProgrammingSkills,
      isTumaiMember,
      hasTeam,
      dietaryRestrictions,
      tshirtCut,
      tshirtSize,
      discoverySource,
      consentSharing,
      wantsCv,
      rejoinTeam,
      existingTeam,
      cvAlwaysOptional,
    ]
  );

  const showCvInput = cvAlwaysOptional || wantsCv === "true";

  return (
    <>
      {/* Personal Information */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">Personal Information</h2>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="First Name" name="firstName" required placeholder="Your first name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <InputField label="Last Name" name="lastName" required placeholder="Your last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <InputField label="Date of Birth" name="dateOfBirth" type="date" required />
          <RadioGroup
            label="Gender"
            name="gender"
            required
            value={gender}
            onChange={setGender}
            options={[
              { value: "Male", label: "Male" },
              { value: "Female", label: "Female" },
              { value: "Other", label: "Other" },
              { value: "Prefer not to answer", label: "Prefer not to answer" },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Current Location (City)" name="locationCity" required placeholder="e.g. Munich" />
            <InputField label="Country" name="locationCountry" required placeholder="e.g. Germany" />
          </div>
          <InputField label="Nationality" name="nationality" required placeholder="e.g. German" />
        </div>
      </Card>

      {/* Academic */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">Academic Background</h2>
        <div className="mt-4 space-y-4">
          <RadioGroup
            label="Are you currently studying at a university?"
            name="currentlyStudying"
            required
            value={currentlyStudying}
            onChange={setCurrentlyStudying}
            options={[
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]}
          />
          {currentlyStudying === "true" && (
            <>
              <SelectField
                label="University"
                name="university"
                required
                value={university}
                onChange={(e) => setUniversity(e.target.value)}
                options={[
                  ...UNIVERSITIES.map((u) => ({ value: u, label: u })),
                  { value: "Other", label: "Other" },
                ]}
              />
              {university === "Other" && (
                <InputField label="University Name" name="universityOther" required placeholder="Enter your university" value={universityOther} onChange={(e) => setUniversityOther(e.target.value)} />
              )}
              <SelectField
                label="Degree"
                name="degree"
                required
                value={degree}
                onChange={(e) => setDegree(e.target.value)}
                options={[
                  { value: "Bachelor's degree", label: "Bachelor's degree" },
                  { value: "Master's degree", label: "Master's degree" },
                  { value: "PhD or doctorate", label: "PhD or doctorate" },
                  { value: "Other", label: "Other" },
                ]}
              />
              <SelectField
                label="Field of Study"
                name="fieldOfStudy"
                required
                value={fieldOfStudy}
                onChange={(e) => setFieldOfStudy(e.target.value)}
                options={[
                  ...FIELDS_OF_STUDY.map((f) => ({ value: f, label: f })),
                  { value: "Other", label: "Other" },
                ]}
              />
              {fieldOfStudy === "Other" && (
                <InputField label="Field of Study" name="fieldOfStudyOther" required placeholder="Enter your field" value={fieldOfStudyOther} onChange={(e) => setFieldOfStudyOther(e.target.value)} />
              )}
              <InputField label="Expected Graduation Date" name="graduationDate" placeholder="e.g. 08/2027" />
            </>
          )}
        </div>
      </Card>

      {/* Skills & Experience */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">Skills & Experience</h2>
        <div className="mt-4 space-y-4">
          <RadioGroup
            label="Do you have any programming skills?"
            name="hasProgrammingSkills"
            required
            value={hasProgrammingSkills}
            onChange={setHasProgrammingSkills}
            options={[
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]}
          />
          <RadioGroup
            label="Are you a TUM.ai member?"
            name="isTumaiMember"
            required
            value={isTumaiMember}
            onChange={setIsTumaiMember}
            options={[
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]}
          />
          <div>
            <label className="block text-sm text-text-muted">
              What is your previous experience with hackathons or similar events? <span className="text-error">*</span>
            </label>
            <textarea
              name="hackathonExperience"
              required
              rows={3}
              placeholder="Tell us about your experience in 2-3 sentences..."
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
            />
          </div>
          <InputField label="LinkedIn / Social Media" name="linkedIn" placeholder="https://linkedin.com/in/..." />
          <InputField label="GitHub" name="github" placeholder="https://github.com/..." />
          <InputField label="Website / Blog" name="website" placeholder="https://..." />
        </div>
      </Card>

      {/* Team */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">Team</h2>
        <div className="mt-4 space-y-4">
          <RadioGroup
            label="Do you already have a team?"
            name="hasTeam"
            required
            value={hasTeam}
            onChange={(val) => {
              setHasTeam(val);
              if (val === "false") setTeamMemberCount(0);
              if (val === "new_team" && teamMemberCount === 0) setTeamMemberCount(1);
              if (val === "existing") {
                setRejoinTeam(true);
              } else {
                setRejoinTeam(val === "existing" ? true : null);
              }
            }}
            options={[
              ...(existingTeam
                ? [{ value: "existing", label: `Yes, with ${existingTeam.teamName}` }]
                : []),
              { value: "new_team", label: existingTeam ? "Yes, with a new team" : "Yes" },
              { value: "false", label: "No" },
            ]}
          />
          {hasTeam === "new_team" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-muted">Team members (up to 4)</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTeamMemberCount(Math.max(0, teamMemberCount - 1))}
                    disabled={teamMemberCount <= 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-text-muted transition-colors hover:border-white/20 hover:text-text-primary disabled:opacity-30"
                  >
                    -
                  </button>
                  <span className="flex h-8 w-8 items-center justify-center font-mono text-sm text-gold">
                    {teamMemberCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTeamMemberCount(Math.min(4, teamMemberCount + 1))}
                    disabled={teamMemberCount >= 4}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-text-muted transition-colors hover:border-white/20 hover:text-text-primary disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
              {Array.from({ length: teamMemberCount }).map((_, i) => (
                <div key={i} className="grid gap-3 rounded-lg border border-white/5 p-4 sm:grid-cols-3">
                  <InputField label="First Name" name={`teamMemberFirstName${i}`} required placeholder="First name" />
                  <InputField label="Last Name" name={`teamMemberLastName${i}`} required placeholder="Last name" />
                  <InputField label="Email" name={`teamMemberEmail${i}`} type="email" required placeholder="email@example.com" />
                </div>
              ))}
            </>
          )}
        </div>
      </Card>

      {/* Logistics */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">Logistics</h2>
        <div className="mt-4 space-y-4">
          <RadioGroup
            label="Dietary Restrictions"
            name="dietaryRestrictions"
            required
            value={dietaryRestrictions}
            onChange={setDietaryRestrictions}
            options={[
              { value: "None", label: "None" },
              { value: "Vegetarian", label: "Vegetarian" },
              { value: "Vegan", label: "Vegan" },
              { value: "Other", label: "Other" },
            ]}
          />
          {dietaryRestrictions === "Other" && (
            <InputField label="Please specify" name="dietaryRestrictionsOther" required placeholder="e.g. Halal, No pork, etc." />
          )}
          <RadioGroup
            label="T-Shirt Cut"
            name="tshirtCut"
            required
            value={tshirtCut}
            onChange={setTshirtCut}
            options={[
              { value: "men's", label: "Men's" },
              { value: "women's", label: "Women's" },
            ]}
          />
          <RadioGroup
            label="T-Shirt Size"
            name="tshirtSize"
            required
            value={tshirtSize}
            onChange={setTshirtSize}
            options={[
              { value: "XS", label: "XS" },
              { value: "S", label: "S" },
              { value: "M", label: "M" },
              { value: "L", label: "L" },
              { value: "XL", label: "XL" },
            ]}
          />
          <div>
            <label className="block text-sm text-text-muted">
              How did you find out about us? <span className="text-error">*</span>
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DISCOVERY_SOURCES.map((src) => (
                <label
                  key={src}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    discoverySource.includes(src)
                      ? "border-gold/40 bg-gold/10 text-gold"
                      : "border-white/10 bg-surface-deep text-text-secondary hover:border-white/20"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={discoverySource.includes(src)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setDiscoverySource([...discoverySource, src]);
                      } else {
                        setDiscoverySource(discoverySource.filter((s) => s !== src));
                      }
                    }}
                    className="sr-only"
                  />
                  {src}
                </label>
              ))}
              <label
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  discoverySource.includes("Other")
                    ? "border-gold/40 bg-gold/10 text-gold"
                    : "border-white/10 bg-surface-deep text-text-secondary hover:border-white/20"
                }`}
              >
                <input
                  type="checkbox"
                  checked={discoverySource.includes("Other")}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setDiscoverySource([...discoverySource, "Other"]);
                    } else {
                      setDiscoverySource(discoverySource.filter((s) => s !== "Other"));
                    }
                  }}
                  className="sr-only"
                />
                Other
              </label>
            </div>
            {discoverySource.includes("Other") && (
              <input
                type="text"
                name="discoverySourceOther"
                placeholder="How did you hear about us?"
                className="mt-2 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
              />
            )}
          </div>
        </div>
      </Card>

      {/* CV Upload */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">CV Upload</h2>
        <div className="mt-4 space-y-4">
          {!cvAlwaysOptional && (
            <RadioGroup
              label="Do you want to upload your CV?"
              name="wantsCv"
              required
              value={wantsCv}
              onChange={setWantsCv}
              options={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
            />
          )}
          {showCvInput && (
            <div>
              <label className="block text-sm text-text-muted">
                CV (PDF, max {CV_MAX_LABEL}){cvAlwaysOptional ? ", optional" : ""}
              </label>
              <input
                type="file"
                name="cv"
                accept=".pdf"
                className="mt-1 w-full text-sm text-text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-gold/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gold hover:file:bg-gold/20"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Additional Notes */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">Anything Else?</h2>
        <div className="mt-4">
          <textarea
            name="additionalNotes"
            rows={3}
            placeholder="Is there anything else you would like to share?"
            className="w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
          />
        </div>
      </Card>

      {/* Optional consent + legal terms */}
      <div className="mb-6 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-white/10 bg-surface-card p-4 transition-colors hover:border-gold/20">
          <input
            type="checkbox"
            checked={consentSharing}
            onChange={(e) => setConsentSharing(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-white/20 bg-surface-deep accent-gold"
          />
          <div>
            <span className="text-sm font-medium text-text-primary">
              Yes, keep me updated about EHL events and share my profile with recruiters and sponsors.
            </span>
            <p className="mt-0.5 text-xs text-text-muted">You can unsubscribe anytime.</p>
          </div>
        </label>

        <p className="text-xs text-text-muted text-center">
          By submitting, you agree to our{" "}
          <a href="/privacy" target="_blank" className="text-gold hover:underline">Privacy Policy</a>
          {" "}and{" "}
          <a href="/privacy#challenge-terms" target="_blank" className="text-gold hover:underline">Challenge Terms</a>
          , including processing of personal data, media usage at events, and intellectual property conditions for sponsor challenges.
        </p>
      </div>
    </>
  );
});
