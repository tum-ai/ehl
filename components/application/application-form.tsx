"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import {
  submitApplication,
  checkEmailHasAccount,
  lookupExistingTeam,
} from "@/lib/actions/applications";

interface ApplicationFormProps {
  chapterId: string;
  chapterName: string;
  chapterSlug: string;
  userProfile?: {
    email: string;
    firstName: string;
    lastName: string;
    formData: Record<string, unknown>;
  } | null;
  currentTeam?: { teamId: string; teamName: string } | null;
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
  onBlur,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
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
        onBlur={onBlur}
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
              required={required}
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function CheckboxField({
  label,
  name,
  required = false,
  checked,
  onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        required={required}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-surface-deep accent-gold"
      />
      <span className="text-sm text-text-secondary">
        {label} {required && <span className="text-error">*</span>}
      </span>
    </label>
  );
}

export function ApplicationForm({ chapterId, chapterName, chapterSlug, userProfile, currentTeam }: ApplicationFormProps) {
  const isLoggedIn = !!userProfile;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  // Form state
  const [email, setEmail] = useState(userProfile?.email ?? "");
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
  const [consentAttendance, setConsentAttendance] = useState(false);
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentNewsletter, setConsentNewsletter] = useState(false);
  const [consentRecruiting, setConsentRecruiting] = useState(false);
  const [consentMedia, setConsentMedia] = useState(false);
  const [consentIpTransfer, setConsentIpTransfer] = useState(false);
  const [consentSponsorData, setConsentSponsorData] = useState(false);
  const [wantsCv, setWantsCv] = useState("");

  // Team match
  const [existingTeam, setExistingTeam] = useState<{ teamId: string; teamName: string } | null>(currentTeam ?? null);
  const [rejoinTeam, setRejoinTeam] = useState<boolean | null>(null);

  const handleEmailBlur = useCallback(async () => {
    if (!email || isLoggedIn) return;

    setLookingUp(true);
    setAccountExists(false);

    // Only check if email is linked to an account (no data revealed)
    const hasAccount = await checkEmailHasAccount(email);
    if (hasAccount) {
      setAccountExists(true);
      setLookingUp(false);
      return;
    }

    // Lookup existing team (only returns team name, no personal data)
    const team = await lookupExistingTeam(email);
    if (team) {
      setExistingTeam(team);
    }

    setLookingUp(false);
  }, [email, isLoggedIn]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const turnstileToken = turnstileRef.current?.getToken() ?? "";

    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
    formData.set("chapterId", chapterId);
    formData.set("firstName", firstName);
    formData.set("lastName", lastName);
    formData.set("email", email);
    formData.set("dietaryRestrictions", dietaryRestrictions);
    formData.set("tshirtCut", tshirtCut);
    formData.set("tshirtSize", tshirtSize);
    formData.set("consentAttendance", consentAttendance.toString());
    formData.set("consentPrivacy", consentPrivacy.toString());
    formData.set("consentNewsletter", consentNewsletter.toString());
    formData.set("consentRecruiting", consentRecruiting.toString());
    formData.set("hasTeam", hasTeam === "existing" || hasTeam === "new_team" ? "true" : "false");
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

    const result = await submitApplication(formData);

    setLoading(false);
    if (result?.error) {
      setError(result.error);
      turnstileRef.current?.reset();
    } else if (result?.success) {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <Section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10">
              <svg className="h-8 w-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-black">Application Submitted!</h1>
          <p className="mt-3 text-text-secondary">
            Thanks for applying to <strong className="text-gold">{chapterName}</strong>.
            We sent a confirmation to your email. We will review your application and get back to you soon.
          </p>
        </div>
      </Section>
    );
  }

  // Show email field state
  const showForm = isLoggedIn || (email && !accountExists);

  return (
    <form onSubmit={handleSubmit} className="relative mx-auto max-w-2xl">
      {/* Auth banner for logged-in users */}
      {isLoggedIn && (
        <Card className="mb-6 border-gold/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/10">
              <svg className="h-5 w-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-text-primary">
                Logged in as {userProfile.firstName} {userProfile.lastName}
              </p>
              <p className="text-sm text-text-secondary">
                Your profile data has been pre-filled. You can update any field below.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Auth prompt for non-logged-in users */}
      {!isLoggedIn && (
        <Card className="mb-6 border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple/10">
              <svg className="h-5 w-5 text-purple-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm text-text-secondary">
                Already have an account?{" "}
                <Link href={`/login?redirect=/apply/${chapterSlug}`} className="text-gold hover:underline font-medium">
                  Log in
                </Link>
                {" "}to pre-fill your details.{" "}
                <Link href={`/register?redirect=/apply/${chapterSlug}`} className="text-purple-light hover:underline font-medium">
                  Register
                </Link>
                {" "}to create an account.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Email (only for non-logged-in users) */}
      {!isLoggedIn && (
        <Card className="mb-6">
          <h2 className="text-lg font-bold">Email</h2>
          <div className="mt-4">
            <InputField
              label="Email"
              name="email"
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setAccountExists(false); }}
              onBlur={handleEmailBlur}
            />
            {lookingUp && (
              <p className="mt-2 text-sm text-text-muted">Checking...</p>
            )}
            {accountExists && (
              <div className="mt-3 rounded-lg border border-gold/20 bg-gold/5 p-3">
                <p className="text-sm text-gold">
                  This email is already linked to an account.{" "}
                  <Link href={`/login?redirect=/apply/${chapterSlug}`} className="underline font-medium">
                    Log in
                  </Link>
                  {" "}to apply with your saved profile, or{" "}
                  <button
                    type="button"
                    onClick={() => setAccountExists(false)}
                    className="underline font-medium"
                  >
                    continue without logging in
                  </button>.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}


      {/* Full form (shown for logged-in users always, for others after email is entered) */}
      {showForm && (
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
                  // When selecting existing team, mark rejoinTeam
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
              {wantsCv === "true" && (
                <div>
                  <label className="block text-sm text-text-muted">CV (PDF, max 10MB)</label>
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

          {/* Consent */}
          <Card className="mb-6">
            <h2 className="text-lg font-bold">Consent</h2>
            <p className="mt-1 text-xs text-text-muted">
              All consents are voluntary and may be revoked at any time. Fields marked with * are required for participation.
            </p>
            <div className="mt-4 space-y-3">
              {/* ── Required consents ── */}
              <CheckboxField
                label="I confirm that I will be available to participate at this event if accepted. *"
                name="consentAttendance"
                required
                checked={consentAttendance}
                onChange={setConsentAttendance}
              />
              <CheckboxField
                label="I agree to the processing of my personal data in accordance with the privacy policy. I consent to the processing of my special categories of personal data (dietary preferences, allergies, date of birth, gender, nationality) for catering planning and statistical purposes. *"
                name="consentPrivacy"
                required
                checked={consentPrivacy}
                onChange={setConsentPrivacy}
              />
              <CheckboxField
                label="I consent to the use of photos and videos of me taken during the event for marketing, social media, press releases, and event documentation by EHL and event sponsors. *"
                name="consentMedia"
                required
                checked={consentMedia}
                onChange={setConsentMedia}
              />
              <CheckboxField
                label="I agree that I will only use challenge data provided by sponsors to solve the challenge, and that intellectual property rights to submissions may be subject to terms outlined in the challenge description. *"
                name="consentIpTransfer"
                required
                checked={consentIpTransfer}
                onChange={setConsentIpTransfer}
              />
              {/* ── Optional consents ── */}
              <CheckboxField
                label="I consent to receive newsletters by email with information about events, hackathon tips, and partner offers."
                name="consentNewsletter"
                checked={consentNewsletter}
                onChange={setConsentNewsletter}
              />
              <CheckboxField
                label="I consent to the sharing of my resume and profile data with recruiters and sponsors for potential job opportunities."
                name="consentRecruiting"
                checked={consentRecruiting}
                onChange={setConsentRecruiting}
              />
              <CheckboxField
                label="I agree that my name, university, and contact information may be shared with event sponsors for follow-up purposes."
                name="consentSponsorData"
                checked={consentSponsorData}
                onChange={setConsentSponsorData}
              />
            </div>
          </Card>

          {error && (
            <div className="mb-6 rounded-lg border border-error/20 bg-error/5 p-4">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <Turnstile ref={turnstileRef} />

          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !consentAttendance || !consentPrivacy}>
              {loading ? "Submitting..." : "Submit Application"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
