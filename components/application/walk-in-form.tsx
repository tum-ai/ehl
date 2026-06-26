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

  const [email, setEmail] = useState(signedInEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const turnstileRef = useRef<TurnstileRef>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<ApplicationFieldsHandle>(null);

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
    if (!isSignedIn) {
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
    fields.populate(formData);

    const cv = formData.get("cv");
    if (cv instanceof File && cv.size > 10 * 1024 * 1024) {
      setError("Your CV is too large. Please upload a PDF under 10MB.");
      setLoading(false);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }

    try {
      const result = await submitWalkInApplication(formData);
      if ("error" in result) {
        setError(result.error);
        turnstileRef.current?.reset();
      } else {
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
    } catch {
      setError(
        "We couldn't complete your registration. Please check your connection and try again."
      );
      turnstileRef.current?.reset();
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    } finally {
      setLoading(false);
    }
  }

  if (checkInToken) {
    return (
      <Section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-md text-center">
          <h1 className="text-2xl font-black">You&apos;re registered!</h1>
          <p className="mt-3 text-text-secondary">
            Welcome to <strong className="text-gold">{chapterName}</strong>. Your account
            has been created and you are logged in.
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
              This creates your EHL account and registers you for the event. You will be
              accepted automatically. Already have an account?{" "}
              <Link href="/login" className="text-gold hover:underline font-medium">
                Sign in
              </Link>
              {" "}first, then reopen this link.
            </p>
          </div>
        </div>
      </Card>

      {/* Account credentials */}
      <Card className="mb-6">
        <h2 className="text-lg font-bold">
          {isSignedIn ? "Your Account" : "Create Your Account"}
        </h2>
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
          {!isSignedIn && (
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

      <ApplicationFields ref={fieldsRef} cvAlwaysOptional />

      {error && (
        <div ref={errorRef} className="mb-6 rounded-lg border border-error/20 bg-error/5 p-4">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      <Turnstile ref={turnstileRef} />

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? "Registering..." : "Register & Create Account"}
        </Button>
      </div>
    </form>
  );
}
