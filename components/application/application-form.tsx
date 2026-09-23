"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import {
  ApplicationFields,
  type ApplicationFieldsHandle,
} from "@/components/application/application-fields";
import {
  startApplication,
  confirmApplication,
  checkEmailHasAccount,
  lookupExistingTeam,
} from "@/lib/actions/applications";
import {
  CV_MAX_BYTES,
  CV_TOO_LARGE_MESSAGE,
  REQUEST_TOO_LARGE_MESSAGE,
} from "@/lib/config/upload-limits";
import { isPayloadTooLargeError, toReportableError } from "@/lib/error-report";
import { reportClientError } from "@/lib/report-client-error";

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
  /** Per-chapter application requirements (chapters.require_cv / require_motivation). */
  requireCv?: boolean;
  requireMotivation?: boolean;
}

export function ApplicationForm({
  chapterId,
  chapterName,
  chapterSlug,
  userProfile,
  currentTeam,
  requireCv = false,
  requireMotivation = false,
}: ApplicationFormProps) {
  const isLoggedIn = !!userProfile;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [cvUploadFailed, setCvUploadFailed] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  // An existing account chose to apply by confirming a code instead of logging in.
  const [continueWithCode, setContinueWithCode] = useState(false);
  // The code step. The application form stays MOUNTED (only hidden) while it is
  // shown, because confirming resends the whole form, CV included.
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<ApplicationFieldsHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [email, setEmail] = useState(userProfile?.email ?? "");
  const [existingTeam, setExistingTeam] = useState<{ teamId: string; teamName: string } | null>(currentTeam ?? null);

  const handleEmailBlur = useCallback(async () => {
    if (!email || isLoggedIn) return;

    setLookingUp(true);
    setAccountExists(false);
    setContinueWithCode(false);

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

  // A new address creates its account on submit, so it sets a password here.
  // A signed-in user and an existing account (confirming by code) do not.
  const needsPassword = !isLoggedIn && !accountExists;

  function buildFormData(form: HTMLFormElement): FormData {
    const formData = new FormData(form);
    formData.set("chapterId", chapterId);
    formData.set("email", email);
    fieldsRef.current?.populate(formData);
    if (!needsPassword) {
      formData.delete("password");
      formData.delete("passwordConfirm");
    }
    return formData;
  }

  function showSuccess(result: { cvUploadFailed: boolean; signedIn: boolean }) {
    setCvUploadFailed(result.cvUploadFailed);
    setSignedIn(result.signedIn);
    setSuccess(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fields = fieldsRef.current;
    if (!fields) return;

    // Client-side validation for required fields (especially radio/select that browser can't validate)
    const missing = fields.getMissingFields(e.currentTarget);
    if (!email.trim()) missing.unshift("Email");
    const password = (e.currentTarget.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";
    const passwordConfirm =
      (e.currentTarget.elements.namedItem("passwordConfirm") as HTMLInputElement | null)?.value ?? "";
    if (needsPassword && !password) missing.push("Password");
    if (missing.length > 0) {
      setError(`Please fill in the following required fields: ${missing.join(", ")}`);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    if (needsPassword && password.length < 8) {
      setError("Password must be at least 8 characters.");
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    if (needsPassword && password !== passwordConfirm) {
      setError("Passwords do not match.");
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }

    setLoading(true);

    const turnstileToken = turnstileRef.current?.getToken() ?? "";

    const formData = buildFormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);

    // Client-side CV size guard. This is the ONLY guard that can produce a
    // useful message: a body over the platform limit is rejected at the edge,
    // so the server action never runs and cannot answer for it. See
    // lib/config/upload-limits.ts.
    const cv = formData.get("cv");
    if (cv instanceof File && cv.size > CV_MAX_BYTES) {
      setError(CV_TOO_LARGE_MESSAGE);
      setLoading(false);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }

    try {
      const result = await startApplication(formData);
      if (result && "error" in result) {
        setError(result.error);
        turnstileRef.current?.reset();
      } else if (result && "verificationId" in result) {
        setVerificationId(result.verificationId);
        setCodeSentTo(result.email);
        setCode("");
        setCodeError(null);
        // The Turnstile token was spent; a resubmit from the form needs a new one.
        turnstileRef.current?.reset();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (result && "success" in result) {
        showSuccess(result);
      } else {
        setError("Something went wrong. Please try again.");
        turnstileRef.current?.reset();
      }
    } catch (err) {
      // Thrown errors (network drop on shared event WiFi, body-limit
      // rejection, unexpected server error) must not leave the button stuck.
      //
      // Report BEFORE branching: an oversized body is rejected at the edge, so
      // this is the only record that the attempt ever happened. Swallowing it
      // here is what previously made this class of failure invisible in both
      // Vercel logs and event_log.
      reportClientError(
        toReportableError(err, {
          form: "apply",
          cvBytes: cv instanceof File ? cv.size : 0,
        }),
        "apply-submit"
      );
      setError(
        isPayloadTooLargeError(err)
          ? REQUEST_TOO_LARGE_MESSAGE
          : "We couldn't submit your application. Please check your connection and try again."
      );
      turnstileRef.current?.reset();
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form || !verificationId) return;
    setCodeError(null);
    setLoading(true);

    const formData = buildFormData(form);
    formData.set("verificationId", verificationId);
    formData.set("code", code);

    try {
      const result = await confirmApplication(formData);
      if (result && "success" in result) {
        showSuccess(result);
      } else if (result && "error" in result) {
        setCodeError(result.error);
      } else {
        setCodeError("Something went wrong. Please try again.");
      }
    } catch (err) {
      reportClientError(
        toReportableError(err, { form: "apply-confirm" }),
        "apply-confirm"
      );
      setCodeError(
        isPayloadTooLargeError(err)
          ? REQUEST_TOO_LARGE_MESSAGE
          : "We couldn't confirm your application. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function backToForm() {
    setVerificationId(null);
    setCode("");
    setCodeError(null);
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
            You will receive a confirmation email shortly. We will review your application and get back to you soon.
          </p>
          <p className="mt-3 text-sm text-text-secondary">
            {isLoggedIn
              ? "You can follow it from your dashboard."
              : signedIn
                ? "We created your EHL account and logged you in, so you can follow your application from your dashboard."
                : "It was added to your existing EHL account. Log in to follow it from your dashboard."}
          </p>
          <div className="mt-6 flex justify-center">
            {isLoggedIn || signedIn ? (
              <Link href="/dashboard" className="text-gold hover:underline font-medium">
                Go to your dashboard
              </Link>
            ) : (
              <Link href="/login?redirect=/dashboard" className="text-gold hover:underline font-medium">
                Log in
              </Link>
            )}
          </div>
          {cvUploadFailed && (
            <div className="mt-5 rounded-lg border border-gold/30 bg-gold/5 p-4 text-left">
              <p className="text-sm text-gold">
                Your application was saved, but we could not upload your CV.
                You can reply to the confirmation email with your CV attached,
                and we will add it to your application.
              </p>
            </div>
          )}
        </div>
      </Section>
    );
  }

  // Show email field state
  const showForm = isLoggedIn || (email && (!accountExists || continueWithCode));

  return (
    <>
    {verificationId && (
      <form onSubmit={handleConfirm} className="relative mx-auto max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-black">Confirm your email</h1>
          <p className="mt-3 text-text-secondary">
            We sent a 6-digit code to <strong className="text-text-primary">{codeSentTo}</strong>.
            Your application to <strong className="text-gold">{chapterName}</strong> is sent once you enter it.
          </p>
        </div>
        <Card>
          <div className="flex flex-col items-center">
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              required
              aria-label="Verification code"
              className="w-48 rounded-xl border border-white/10 bg-surface-deep px-4 py-4 text-center font-mono text-3xl font-black tracking-[0.3em] text-gold placeholder:text-text-muted/30 focus:border-gold/40 focus:outline-none"
              autoFocus
            />

            {codeError && (
              <div className="mt-4 w-full rounded-lg border border-error/20 bg-error/5 p-3">
                <p className="text-center text-sm text-error">{codeError}</p>
              </div>
            )}

            <div className="mt-6 w-full">
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading ? "Confirming..." : "Confirm & Submit Application"}
              </Button>
            </div>

            <p className="mt-4 text-center text-xs text-text-muted">
              The code expires in 15 minutes. Check your spam folder.{" "}
              <button type="button" onClick={backToForm} className="underline">
                Back to the form
              </button>{" "}
              to fix a detail or get a new code.
            </p>
          </div>
        </Card>
      </form>
    )}
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className={`relative mx-auto max-w-2xl${verificationId ? " hidden" : ""}`}
    >
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
                {" "}to pre-fill your details. New here? Applying creates your EHL account,
                so you can follow your application from your dashboard.
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
            <div>
              <label className="block text-sm text-text-muted">
                Email <span className="text-error">*</span>
              </label>
              <input
                type="email"
                name="email"
                required
                placeholder="your@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAccountExists(false);
                  setContinueWithCode(false);
                }}
                onBlur={handleEmailBlur}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
              />
            </div>
            {lookingUp && (
              <p className="mt-2 text-sm text-text-muted">Checking...</p>
            )}
            {accountExists && !continueWithCode && (
              <div className="mt-3 rounded-lg border border-gold/20 bg-gold/5 p-3">
                <p className="text-sm text-gold">
                  This email is already linked to an account.{" "}
                  <Link href={`/login?redirect=/apply/${chapterSlug}`} className="underline font-medium">
                    Log in
                  </Link>
                  {" "}to apply with your saved profile, or{" "}
                  <button
                    type="button"
                    onClick={() => setContinueWithCode(true)}
                    className="underline font-medium"
                  >
                    continue without logging in
                  </button>
                  {" "}and confirm with a code we email you.
                </p>
              </div>
            )}
            {email && needsPassword && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text-muted">
                    Password <span className="text-error">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={8}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted">
                    Confirm password <span className="text-error">*</span>
                  </label>
                  <input
                    type="password"
                    name="passwordConfirm"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                  />
                </div>
                <p className="text-xs text-text-muted sm:col-span-2">
                  This creates your EHL account. We email you a code to confirm the address before your application is sent.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Full form (shown for logged-in users always, for others after email is entered) */}
      {showForm && (
        <>
          <ApplicationFields
            ref={fieldsRef}
            userProfile={userProfile}
            existingTeam={existingTeam}
            cvMode={requireCv ? "required" : "gated"}
            requireMotivation={requireMotivation}
          />

          {error && (
            <div ref={errorRef} className="mb-6 rounded-lg border border-error/20 bg-error/5 p-4">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <Turnstile ref={turnstileRef} />

          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting..." : "Submit Application"}
            </Button>
          </div>
        </>
      )}
    </form>
    </>
  );
}
