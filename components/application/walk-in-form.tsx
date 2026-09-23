"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import {
  ApplicationFields,
  type ApplicationFieldsHandle,
} from "@/components/application/application-fields";
import { submitWalkInApplication } from "@/lib/actions/walk-in";
import {
  CV_MAX_BYTES,
  CV_TOO_LARGE_MESSAGE,
  REQUEST_TOO_LARGE_MESSAGE,
} from "@/lib/config/upload-limits";
import { isPayloadTooLargeError, toReportableError } from "@/lib/error-report";
import { reportClientError } from "@/lib/report-client-error";

interface WalkInFormProps {
  walkInToken: string;
  chapterId: string;
  chapterName: string;
  // When set, the visitor is already signed in: reuse their account. The email
  // is prefilled + locked and the password fields are hidden (the server reuses
  // the authenticated session).
  signedInEmail?: string | null;
}

export function WalkInForm({ walkInToken, chapterName, signedInEmail }: WalkInFormProps) {
  const isSignedIn = !!signedInEmail;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkInToken, setCheckInToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [cvUploadFailed, setCvUploadFailed] = useState(false);

  // "new" creates an EHL account (password + confirm). "existing" registers with
  // an account the walk-in already has (its password only), so they never have to
  // leave this page to sign in. The server has the final say and answers with a
  // code that flips the mode when the choice was wrong.
  const [accountMode, setAccountMode] = useState<"new" | "existing">("new");
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  // Which mode actually registered them, for the success copy.
  const [registeredWithExisting, setRegisteredWithExisting] = useState(false);

  const [email, setEmail] = useState(signedInEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const turnstileRef = useRef<TurnstileRef>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<ApplicationFieldsHandle>(null);
  const accountCardRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fields = fieldsRef.current;
    if (!fields) return;

    const missing = fields.getMissingFields(e.currentTarget);
    if (!email.trim()) missing.unshift("Email");
    if (missing.length > 0) {
      setError(`Please fill in the following required fields: ${missing.join(", ")}`);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }

    // Password is only needed to CREATE a new account. A signed-in owner reuses
    // their existing account, so skip the password checks for them.
    if (!isSignedIn && accountMode === "existing") {
      if (!password) {
        setError("Please enter your EHL account password.");
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        return;
      }
    } else if (!isSignedIn) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        return;
      }
    }

    setLoading(true);

    const turnstileToken = turnstileRef.current?.getToken() ?? "";

    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
    formData.set("walkInToken", walkInToken);
    formData.set("email", email);
    formData.set("password", password);
    formData.set("accountMode", isSignedIn ? "new" : accountMode);
    fields.populate(formData);

    // Only guard that can speak: see lib/config/upload-limits.ts. On event WiFi
    // a generic "check your connection" is especially misleading, since the
    // network is the first thing anyone at a venue suspects.
    const cv = formData.get("cv");
    if (cv instanceof File && cv.size > CV_MAX_BYTES) {
      setError(CV_TOO_LARGE_MESSAGE);
      setLoading(false);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }

    try {
      const result = await submitWalkInApplication(formData);
      if ("error" in result) {
        turnstileRef.current?.reset();
        if (result.code === "account_exists" && accountMode === "new") {
          // Keep everything they typed, only swap the password fields.
          switchMode("existing", result.error);
        } else if (result.code === "no_account" && accountMode === "existing") {
          switchMode("new", result.error);
        } else {
          setError(result.error);
          setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        }
      } else {
        setRegisteredWithExisting(isSignedIn || accountMode === "existing");
        setCvUploadFailed(!!result.cvUploadFailed);
        setCheckInToken(result.checkInToken);
        try {
          const url = await QRCode.toDataURL(result.checkInToken, {
            width: 320,
            margin: 1,
            color: { dark: "#0B0B1A", light: "#FFFFFF" },
          });
          setQrDataUrl(url);
        } catch {
          // The token itself is shown as a fallback if QR rendering fails.
          setQrDataUrl(null);
        }
      }
    } catch (err) {
      reportClientError(
        toReportableError(err, {
          form: "walk-in",
          cvBytes: cv instanceof File ? cv.size : 0,
        }),
        "walk-in-submit"
      );
      setError(
        isPayloadTooLargeError(err)
          ? REQUEST_TOO_LARGE_MESSAGE
          : "We couldn't complete your registration. Please check your connection and try again."
      );
      turnstileRef.current?.reset();
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    } finally {
      setLoading(false);
    }
  }

  function switchMode(mode: "new" | "existing", notice: string | null = null) {
    setAccountMode(mode);
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setModeNotice(notice);
    if (notice) {
      setTimeout(() => accountCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  }

  if (checkInToken) {
    return (
      <Section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-md text-center">
          <h1 className="text-2xl font-black">You&apos;re registered!</h1>
          <p className="mt-3 text-text-secondary">
            Welcome to <strong className="text-gold">{chapterName}</strong>.{" "}
            {registeredWithExisting
              ? "You're in with your existing EHL account and logged in."
              : "Your account has been created and you are logged in."}
          </p>
          <div className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-6">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Your check-in QR code"
                className="mx-auto h-56 w-56"
              />
            ) : (
              <p className="break-all font-mono text-sm text-gold">{checkInToken}</p>
            )}
            <p className="mt-4 text-sm font-medium text-text-primary">
              Show this to a volunteer to check in.
            </p>
          </div>
          {cvUploadFailed && (
            <div className="mt-5 rounded-lg border border-gold/30 bg-gold/5 p-4 text-left">
              <p className="text-sm text-gold">
                Your registration was saved, but we could not upload your CV. You can
                add it later from your dashboard.
              </p>
            </div>
          )}
          <div className="mt-6">
            <Link href="/dashboard">
              <Button>Go to dashboard</Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-text-muted">
            You can form or join a team later from the event hub.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="relative mx-auto max-w-2xl">
      <div className="mb-6 text-center">
        <h1 className="font-hero-display text-3xl font-black sm:text-4xl">
          Walk-In Registration
        </h1>
        <p className="mt-2 font-hero-body text-text-secondary">
          {chapterName}
        </p>
      </div>

      {/* Account-creation banner */}
      <Card className="mb-6 border-purple/20">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple/10">
            <svg className="h-5 w-5 text-purple-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-text-primary">Register and join in one step</p>
            <p className="text-sm text-text-secondary">
              {isSignedIn
                ? "This registers you for the event with your EHL account. You will be accepted automatically."
                : "This registers you for the event and you will be accepted automatically. Already have an EHL account? Choose it below and use your password, no need to sign in first."}
            </p>
          </div>
        </div>
      </Card>

      {/* Account credentials */}
      <div ref={accountCardRef}>
      <Card className="mb-6">
        <h2 className="text-lg font-bold">
          {isSignedIn
            ? "Your Account"
            : accountMode === "existing"
              ? "Sign In With Your Account"
              : "Create Your Account"}
        </h2>
        {!isSignedIn && (
          <div
            role="radiogroup"
            aria-label="Do you already have an EHL account?"
            className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-surface-deep p-1"
          >
            {(
              [
                ["new", "I'm new to EHL"],
                ["existing", "I already have an account"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={accountMode === mode}
                onClick={() => accountMode !== mode && switchMode(mode)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  accountMode === mode
                    ? "bg-purple/20 text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {modeNotice && (
          <div className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3">
            <p className="text-sm text-gold">{modeNotice}</p>
          </div>
        )}
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-text-muted">
              Email <span className="text-error">*</span>
            </label>
            <input
              type="email"
              name="email"
              required
              readOnly={isSignedIn}
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`mt-1 w-full rounded-lg border border-white/10 px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none ${
                isSignedIn ? "bg-white/5 cursor-not-allowed" : "bg-surface-deep"
              }`}
            />
            {isSignedIn && (
              <p className="mt-1 text-xs text-text-muted">
                You&apos;re signed in: we&apos;ll register you for this match with your existing account.
              </p>
            )}
          </div>
          {!isSignedIn && accountMode === "existing" && (
            <div>
              <label className="block text-sm text-text-muted">
                Your EHL password <span className="text-error">*</span>
              </label>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
              />
              <p className="mt-1 text-xs text-text-muted">
                {/* New tab so this form, and everything typed into it, survives. */}
                <Link
                  href="/forgot-password"
                  target="_blank"
                  rel="noopener"
                  className="text-purple hover:text-purple-light"
                >
                  Forgot password?
                </Link>
              </p>
            </div>
          )}
          {!isSignedIn && accountMode === "new" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text-muted">
                  Password <span className="text-error">*</span>
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-text-muted">
                  Confirm Password <span className="text-error">*</span>
                </label>
                <input
                  type="password"
                  name="confirmPassword"
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
      </Card>
      </div>

      <ApplicationFields ref={fieldsRef} cvMode="optional" />

      {error && (
        <div ref={errorRef} className="mb-6 rounded-lg border border-error/20 bg-error/5 p-4">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      <Turnstile ref={turnstileRef} />

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading
            ? "Registering..."
            : isSignedIn
              ? "Register"
              : accountMode === "existing"
                ? "Sign In & Register"
                : "Register & Create Account"}
        </Button>
      </div>
    </form>
  );
}
