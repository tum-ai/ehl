"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import { signInJury } from "@/lib/actions/auth";

export default function JuryLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
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
    const result = await signInJury(formData);

    if (result?.error) {
      setError(result.error);
    } else if (result?.success) {
      setSent(true);
    }
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
            <svg className="h-6 w-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-bold">Check your email</h1>
          <p className="mt-2 text-sm text-text-muted">
            We sent a magic link to your email. Click it to access the jury portal.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <div className="flex flex-col items-center">
          <Image
            src="/images/ehl-logo.svg"
            alt="EHL"
            width={120}
            height={60}
            className="h-10 w-auto"
          />
          <p className="mt-2 text-sm text-text-muted">Jury Portal</p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm text-text-muted">Email</label>
            <input
              type="email"
              name="email"
              placeholder="jury@example.com"
              required
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-error">{error}</p>
          )}

          <Turnstile ref={turnstileRef} />

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send Magic Link"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted">
          You need a jury invitation to access this portal.
        </p>
      </Card>
    </div>
  );
}
