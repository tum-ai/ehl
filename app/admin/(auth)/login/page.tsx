"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { signInAdminWithGoogle } from "@/lib/actions/auth";

function LoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "not_authorized"
      ? "Access denied. Your Google account is not authorized for admin access."
      : null
  );

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);

    const result = await signInAdminWithGoogle();

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-xl font-bold italic text-gold">EHL</h1>
        <p className="mt-1 text-sm text-text-muted">Admin Login</p>
      </div>

      <div className="mt-6">
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-surface-deep px-4 py-3 font-medium text-text-primary transition-all hover:bg-white/5 hover:border-white/20 disabled:opacity-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {loading ? "Redirecting..." : "Sign in with Google"}
        </button>

        <p className="mt-4 text-center text-xs text-text-muted">
          Only authorized accounts can access the admin panel.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-error/10 px-4 py-3 text-center text-sm text-error">
          {error}
        </p>
      )}
    </Card>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Suspense
        fallback={
          <Card className="w-full max-w-sm">
            <div className="text-center">
              <Image
            src="/images/ehl-logo.svg"
            alt="EHL"
            width={120}
            height={60}
            className="h-10 w-auto"
          />
              <p className="mt-1 text-sm text-text-muted">Admin Login</p>
            </div>
          </Card>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
