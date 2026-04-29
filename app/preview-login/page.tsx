import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkRateLimit, authLimiter } from "@/lib/ratelimit";

async function login(formData: FormData) {
  "use server";

  // Rate limit to prevent brute-force
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await checkRateLimit(authLimiter, `preview:${ip}`);
  if (rl.limited) {
    redirect("/preview-login?error=rate");
  }

  const password = formData.get("password") as string;
  if (password === process.env.PREVIEW_PASSWORD) {
    (await cookies()).set("preview-auth", password, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
    redirect("/");
  }
  redirect("/preview-login?error=1");
}

export default async function PreviewLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-deep">
      <form action={login} className="w-full max-w-sm space-y-4 px-6">
        <h1 className="text-center text-xl font-bold text-text-primary">
          Preview Access
        </h1>
        <input
          name="password"
          type="password"
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-white/10 bg-surface-card px-4 py-3 text-text-primary placeholder:text-text-muted focus:border-purple focus:outline-none"
        />
        {error === "rate" && (
          <p className="text-center text-sm text-red-400">Too many attempts. Try again later.</p>
        )}
        {error && error !== "rate" && (
          <p className="text-center text-sm text-red-400">Wrong password</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-gold px-4 py-3 font-bold text-surface-deep transition-colors hover:bg-gold/90"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
