"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import { requestPasswordReset } from "@/lib/actions/auth";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [noAccountAccepted, setNoAccountAccepted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNoAccountAccepted(false);
    setLoading(true);

    let turnstileToken: string | null = null;
    if (turnstileRef.current) {
      try {
        turnstileToken = await turnstileRef.current.execute();
      } catch (err) {
        console.warn("[Turnstile] Challenge failed, submitting without token:", err);
        turnstileToken = "";
      }
    }

    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
    const email = formData.get("email") as string;
    const result = await requestPasswordReset(formData);

    setLoading(false);
    if (result?.error) {
      if (result.error === "no_account_accepted") {
        setNoAccountAccepted(true);
        setSubmittedEmail(email);
      } else {
        setError(result.error);
      }
    } else {
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
          </div>
          <h1 className="font-hero-display text-2xl font-black">Check Your Email</h1>
          <p className="mt-3 font-hero-body text-text-secondary">
            If an account with that email exists, we sent a password reset link.
            Check your inbox and spam folder.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm text-gold hover:underline">
            Back to Login
          </Link>
        </div>
      </Section>
    );
  }

  return (
    <Section className="relative overflow-hidden">
      <div className="noise absolute inset-0" />

      <div className="relative mb-8 text-center">
        <h1 className="font-hero-display text-3xl font-black sm:text-4xl">
          <span className="shimmer-text">Reset Password</span>
        </h1>
        <p className="mt-3 font-hero-body text-text-secondary">
          Enter your email and we will send you a reset link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative mx-auto max-w-md">
        <Card>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-muted">
                Email <span className="text-error">*</span>
              </label>
              <input
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-error/20 bg-error/5 p-3">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            {noAccountAccepted && (
              <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
                <p className="text-sm font-medium text-gold">Application accepted!</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Your application has been accepted, but you don&apos;t have an account yet. Register with the same email to get started.
                </p>
                <Link
                  href={`/register?email=${encodeURIComponent(submittedEmail)}`}
                  className="mt-3 inline-block rounded-lg bg-gold px-4 py-2 text-sm font-bold text-surface-deep transition-colors hover:bg-gold/90"
                >
                  Create Account
                </Link>
              </div>
            )}

            <Turnstile ref={turnstileRef} />

            <Button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send Reset Link"}
            </Button>
          </div>

          <p className="mt-4 text-center text-sm text-text-muted">
            Remember your password?{" "}
            <Link href="/login" className="text-gold hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </form>
    </Section>
  );
}
