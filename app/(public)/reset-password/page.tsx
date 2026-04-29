"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Check if we already have a session (from the auth callback redirect)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      }
    });

    // Also listen for auth state changes (PASSWORD_RECOVERY or token exchange)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    setLoading(false);
    if (updateError) {
      setError(updateError.message);
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <h1 className="font-hero-display text-2xl font-black">Password Updated</h1>
          <p className="mt-3 font-hero-body text-text-secondary">
            Your password has been reset successfully.
          </p>
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-gradient-to-r from-gold to-gold-dark px-6 py-2.5 text-sm font-bold text-surface-deep">
            Sign In
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
          <span className="shimmer-text">New Password</span>
        </h1>
        <p className="mt-3 font-hero-body text-text-secondary">
          Choose a new password for your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative mx-auto max-w-md">
        <Card>
          {!ready ? (
            <p className="text-center text-sm text-text-muted">
              Verifying reset link...
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-muted">
                  New Password <span className="text-error">*</span>
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Min. 6 characters"
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
                  placeholder="Repeat password"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-error/20 bg-error/5 p-3">
                  <p className="text-sm text-error">{error}</p>
                </div>
              )}

              <Button type="submit" disabled={loading}>
                {loading ? "Updating..." : "Set New Password"}
              </Button>
            </div>
          )}
        </Card>
      </form>
    </Section>
  );
}
