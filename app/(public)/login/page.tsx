"use client";

import { Suspense, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Turnstile, type TurnstileRef } from "@/components/ui/turnstile";
import { signIn } from "@/lib/actions/auth";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [error, setError] = useState<string | null>(null);
  const [noAccountAccepted, setNoAccountAccepted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNoAccountAccepted(false);
    setLoading(true);

    const turnstileToken = turnstileRef.current?.getToken() ?? "";

    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);
    const email = formData.get("email") as string;
    const result = await signIn(formData, redirectTo ?? undefined);

    if (result?.error) {
      if (result.error === "no_account_accepted") {
        setNoAccountAccepted(true);
        setSubmittedEmail(email);
      } else {
        setError(result.error);
      }
      setLoading(false);
      turnstileRef.current?.reset();
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        <div className="flex flex-col items-center">
          <Image
            src="/images/ehl-logo.svg"
            alt="EHL"
            width={120}
            height={60}
            className="h-10 w-auto"
          />
          <p className="mt-2 text-sm text-text-muted">Team Login</p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm text-text-muted">Email</label>
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="president@team.com"
              required
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted">Password</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-error">{error}</p>
          )}

          {noAccountAccepted && (
            <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
              <p className="text-sm font-medium text-gold">Application accepted!</p>
              <p className="mt-1 text-sm text-text-secondary">
                Your application has been accepted, but you need to create an account first. Register with the same email to get started.
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="mt-4 flex flex-col items-center gap-2">
          <Link href="/forgot-password" className="text-sm text-purple hover:text-purple-light transition-colors">
            Forgot password?
          </Link>
          <p className="text-sm text-text-muted">
            No account yet?{" "}
            <Link
              href={redirectTo ? `/register?redirect=${encodeURIComponent(redirectTo)}` : "/register"}
              className="text-gold hover:underline"
            >
              Register your team
            </Link>
          </p>
        </div>

        <div className="mt-6 border-t border-white/[0.06] pt-4">
          <div className="flex justify-center gap-6 text-xs text-text-muted">
            <Link href="/jury/login" className="hover:text-text-secondary transition-colors">
              Jury Login
            </Link>
            <Link href="/admin/login" className="hover:text-text-secondary transition-colors">
              Admin Login
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
