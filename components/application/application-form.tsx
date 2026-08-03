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
  submitApplication,
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
}

export function ApplicationForm({ chapterId, chapterName, chapterSlug, userProfile, currentTeam }: ApplicationFormProps) {
  const isLoggedIn = !!userProfile;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cvUploadFailed, setCvUploadFailed] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<ApplicationFieldsHandle>(null);

  const [email, setEmail] = useState(userProfile?.email ?? "");
  const [existingTeam, setExistingTeam] = useState<{ teamId: string; teamName: string } | null>(currentTeam ?? null);

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

    const fields = fieldsRef.current;
    if (!fields) return;

    // Client-side validation for required fields (especially radio/select that browser can't validate)
    const missing = fields.getMissingFields(e.currentTarget);
    if (!email.trim()) missing.unshift("Email");
    if (missing.length > 0) {
      setError(`Please fill in the following required fields: ${missing.join(", ")}`);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }

    setLoading(true);

    const turnstileToken = turnstileRef.current?.getToken() ?? "";

    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
    formData.set("chapterId", chapterId);
    formData.set("email", email);
    fields.populate(formData);

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
      const result = await submitApplication(formData);
      if (result?.error) {
        setError(result.error);
        turnstileRef.current?.reset();
      } else if (result?.success) {
        setCvUploadFailed(!!result.cvUploadFailed);
        setSuccess(true);
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
  const showForm = isLoggedIn || (email && !accountExists);

  return (
    <form onSubmit={handleSubmit} noValidate className="relative mx-auto max-w-2xl">
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
                onChange={(e) => { setEmail(e.target.value); setAccountExists(false); }}
                onBlur={handleEmailBlur}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
              />
            </div>
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
          <ApplicationFields
            ref={fieldsRef}
            userProfile={userProfile}
            existingTeam={existingTeam}
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
  );
}
