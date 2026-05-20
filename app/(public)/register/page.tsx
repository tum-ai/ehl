"use client";

import { Suspense, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import {
  startRegistration,
  verifyAndRegister,
  startSoloRegistration,
  verifyAndRegisterSolo,
} from "@/lib/actions/registration";

function InputField({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  defaultValue,
  disabled,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  disabled?: boolean;
  autoComplete?: string;
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
        defaultValue={defaultValue}
        disabled={disabled}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterFlow />
    </Suspense>
  );
}

type Mode = "pick" | "solo" | "team";
type Step = "form" | "verify";

function RegisterFlow() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const inviteToken = searchParams.get("invite");
  const prefillEmail = searchParams.get("email");

  // If invite token or prefill email present, go straight to solo registration
  const [mode, setMode] = useState<Mode>(inviteToken || prefillEmail ? "solo" : "pick");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const turnstileRef = useRef<TurnstileRef>(null);

  // ─── Verification step (shared between solo and team) ──
  if (step === "verify") {
    async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setError(null);
      setLoading(true);

      let result;
      if (mode === "solo") {
        result = await verifyAndRegisterSolo(
          verificationId!,
          code,
          inviteToken ?? undefined,
          redirectTo ?? undefined
        );
      } else {
        result = await verifyAndRegister(verificationId!, code, redirectTo ?? undefined);
      }

      setLoading(false);
      if (result?.error) {
        setError(result.error);
      }
    }

    return (
      <Section className="relative overflow-hidden">
        <div className="noise absolute inset-0" />
        <div className="relative mb-8 text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-purple/30 bg-purple/10">
              <svg className="h-8 w-8 text-purple-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
          </div>
          <h1 className="font-hero-display text-3xl font-black sm:text-4xl">
            <span className="shimmer-text">Verify Your Email</span>
          </h1>
          <p className="mt-3 font-hero-body text-text-secondary">
            We sent a 6-digit code to <strong className="text-text-primary">{email}</strong>
          </p>
        </div>

        <form onSubmit={handleVerify} className="relative mx-auto max-w-sm">
          <Card>
            <div className="flex flex-col items-center">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                required
                className="w-48 rounded-xl border border-white/10 bg-surface-deep px-4 py-4 text-center font-mono text-3xl font-black tracking-[0.3em] text-gold placeholder:text-text-muted/30 focus:border-gold/40 focus:outline-none"
                autoFocus
              />

              {error && (
                <div className="mt-4 w-full rounded-lg border border-error/20 bg-error/5 p-3">
                  <p className="text-center text-sm text-error">{error}</p>
                </div>
              )}

              <div className="mt-6 w-full">
                <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                  {loading ? "Verifying..." : "Verify & Register"}
                </Button>
              </div>

              <p className="mt-4 text-xs text-text-muted">
                Code expires in 15 minutes. Check your spam folder.
              </p>
            </div>
          </Card>
        </form>
      </Section>
    );
  }

  // ─── Mode picker ───────────────────────────────────────
  if (mode === "pick") {
    return (
      <Section className="relative overflow-hidden">
        <div className="noise absolute inset-0" />
        <div className="relative mb-12 text-center">
          <h1 className="text-3xl font-black sm:text-4xl">
            <span className="shimmer-text">Join the EHL</span>
          </h1>
          <p className="mt-3 font-hero-body text-text-secondary">
            Create your account for the European Hackathon League
          </p>
        </div>

        <div className="relative mx-auto grid max-w-2xl gap-4 sm:grid-cols-2">
          <button
            onClick={() => setMode("solo")}
            className="group text-left"
          >
            <Card className="h-full transition-colors group-hover:border-gold/30">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple/10">
                <svg className="h-6 w-6 text-purple-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold">Register Solo</h2>
              <p className="mt-2 text-sm text-text-muted">
                Create your account first, join or create a team later.
                You can browse teams looking for members.
              </p>
            </Card>
          </button>

          <button
            onClick={() => setMode("team")}
            className="group text-left"
          >
            <Card className="h-full transition-colors group-hover:border-gold/30">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
                <svg className="h-6 w-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold">Create a Team</h2>
              <p className="mt-2 text-sm text-text-muted">
                You become the team president. Invite up to 4 members
                who will receive an email to join.
              </p>
            </Card>
          </button>
        </div>

        <p className="relative mt-8 text-center text-sm text-text-muted">
          Already registered?{" "}
          <Link
            href={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login"}
            className="text-gold hover:underline"
          >
            Sign in
          </Link>
        </p>
      </Section>
    );
  }

  // ─── Solo registration form ────────────────────────────
  if (mode === "solo") {
    async function handleSoloSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setError(null);
      setLoading(true);

      const turnstileToken = turnstileRef.current?.getToken() ?? "";

      const formData = new FormData(e.currentTarget);
      if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
      const result = await startSoloRegistration(formData);

      setLoading(false);
      if (result?.error) {
        setError(result.error);
        turnstileRef.current?.reset();
      } else if (result?.verificationId) {
        setVerificationId(result.verificationId);
        setEmail(formData.get("email") as string);
        setStep("verify");
      }
    }

    return (
      <Section className="relative overflow-hidden">
        <div className="noise absolute inset-0" />
        <div className="relative mb-12 text-center">
          <button
            onClick={() => { setMode("pick"); setError(null); }}
            className="mb-4 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>
          <h1 className="text-3xl font-black sm:text-4xl">
            <span className="shimmer-text">
              {inviteToken ? "Accept Team Invite" : "Register Solo"}
            </span>
          </h1>
          <p className="mt-3 font-hero-body text-text-secondary">
            {inviteToken
              ? "Create your account to join the team"
              : "Create your account, join a team later"
            }
          </p>
        </div>

        <form onSubmit={handleSoloSubmit} className="relative mx-auto max-w-md">
          <Card className="mb-6">
            <h2 className="text-lg font-bold">Your Details</h2>
            <div className="mt-4 space-y-4">
              <InputField label="Full Name" name="name" required placeholder="Your full name" autoComplete="name" />
              <InputField
                label="Email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                defaultValue={prefillEmail ?? undefined}
                autoComplete="email"
              />
              <InputField label="Password" name="password" type="password" required placeholder="Min. 6 characters" autoComplete="new-password" />

              {!inviteToken && (
                <label className="flex items-center gap-3 rounded-lg border border-white/5 p-3">
                  <input
                    type="checkbox"
                    name="lookingForTeam"
                    value="true"
                    className="h-4 w-4 rounded border-white/20 bg-surface-deep"
                  />
                  <div>
                    <p className="text-sm font-medium">Looking for a team</p>
                    <p className="text-xs text-text-muted">
                      Other participants without a team can see your profile
                    </p>
                  </div>
                </label>
              )}
            </div>
          </Card>

          {error && (
            <div className="mb-6 rounded-lg border border-error/20 bg-error/5 p-4">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <Turnstile ref={turnstileRef} />

          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              Already registered?{" "}
              <Link
                href={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login"}
                className="text-gold hover:underline"
              >
                Sign in
              </Link>
            </p>
            <Button type="submit" disabled={loading}>
              {loading ? "Sending code..." : "Continue"}
            </Button>
          </div>
        </form>
      </Section>
    );
  }

  // ─── Team registration form ────────────────────────────
  return <TeamRegistrationForm
    redirectTo={redirectTo}
    onBack={() => { setMode("pick"); setError(null); }}
    error={error}
    setError={setError}
    loading={loading}
    setLoading={setLoading}
    setVerificationId={setVerificationId}
    setEmail={setEmail}
    setStep={setStep}
    turnstileRef={turnstileRef}
  />;
}

function TeamRegistrationForm({
  redirectTo,
  onBack,
  error,
  setError,
  loading,
  setLoading,
  setVerificationId,
  setEmail,
  setStep,
  turnstileRef,
}: {
  redirectTo: string | null;
  onBack: () => void;
  error: string | null;
  setError: (e: string | null) => void;
  loading: boolean;
  setLoading: (l: boolean) => void;
  setVerificationId: (id: string) => void;
  setEmail: (e: string) => void;
  setStep: (s: Step) => void;
  turnstileRef: React.RefObject<TurnstileRef | null>;
}) {
  const [memberCount, setMemberCount] = useState(1);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const turnstileToken = turnstileRef.current?.getToken() ?? "";

    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
    const result = await startRegistration(formData);

    setLoading(false);
    if (result?.error) {
      setError(result.error);
      turnstileRef.current?.reset();
    } else if (result?.verificationId) {
      setVerificationId(result.verificationId);
      setEmail(formData.get("presidentEmail") as string);
      setStep("verify");
    }
  }

  return (
    <Section className="relative overflow-hidden">
      <div className="noise absolute inset-0" />
      <div className="relative mb-12 text-center">
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <h1 className="text-3xl font-black sm:text-4xl">
          <span className="shimmer-text">Create Your Team</span>
        </h1>
        <p className="mt-3 font-hero-body text-text-secondary">
          You will be the team president. Members receive an invite email.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative mx-auto max-w-2xl">
        {/* Team Info */}
        <Card className="mb-6">
          <h2 className="text-lg font-bold">Team Information</h2>
          <div className="mt-4 space-y-4">
            <InputField label="Team Name" name="teamName" required placeholder="e.g. Team Rocket" />
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label="University" name="university" placeholder="e.g. TUM" />
              <InputField label="City" name="city" placeholder="e.g. Munich" />
            </div>
          </div>
        </Card>

        {/* Captain */}
        <Card className="mb-6">
          <h2 className="text-lg font-bold">Team President</h2>
          <p className="mt-1 text-sm text-text-muted">
            As president, you manage the roster and handle registrations.
          </p>
          <div className="mt-4 space-y-4">
            <InputField label="Name" name="presidentName" required placeholder="Your full name" autoComplete="name" />
            <InputField label="Email" name="presidentEmail" type="email" required placeholder="you@example.com" autoComplete="email" />
            <InputField label="Password" name="password" type="password" required placeholder="Min. 6 characters" autoComplete="new-password" />
          </div>
        </Card>

        {/* Members */}
        <Card className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Invite Members</h2>
              <p className="mt-1 text-sm text-text-muted">
                They will receive an email to create their own account and join.
                You can also invite more members later.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMemberCount(Math.max(0, memberCount - 1))}
                disabled={memberCount <= 0}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-text-muted transition-colors hover:border-white/20 hover:text-text-primary disabled:opacity-30"
              >
                -
              </button>
              <span className="flex h-8 w-8 items-center justify-center font-mono text-sm text-gold">
                {memberCount}
              </span>
              <button
                type="button"
                onClick={() => setMemberCount(Math.min(4, memberCount + 1))}
                disabled={memberCount >= 4}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-text-muted transition-colors hover:border-white/20 hover:text-text-primary disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
          {memberCount > 0 && (
            <div className="mt-4 space-y-4">
              {Array.from({ length: memberCount }).map((_, i) => (
                <div key={i} className="grid gap-4 rounded-lg border border-white/5 p-4 sm:grid-cols-2">
                  <InputField
                    label={`Member ${i + 1} Name`}
                    name={`memberName${i}`}
                    required
                    placeholder="Full name"
                  />
                  <InputField
                    label={`Member ${i + 1} Email`}
                    name={`memberEmail${i}`}
                    type="email"
                    required
                    placeholder="member@example.com"
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        {error && (
          <div className="mb-6 rounded-lg border border-error/20 bg-error/5 p-4">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        <Turnstile ref={turnstileRef} />

        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Already registered?{" "}
            <Link
              href={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login"}
              className="text-gold hover:underline"
            >
              Sign in
            </Link>
          </p>
          <Button type="submit" disabled={loading}>
            {loading ? "Sending code..." : "Continue"}
          </Button>
        </div>
      </form>
    </Section>
  );
}
