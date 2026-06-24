import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDevPersonas, isDevLoginAdminOnly, isDevLoginEnabled } from "@/lib/dev-login";
import { devLoginAction } from "@/lib/actions/dev-login";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  chapter_admin: "Local Admin",
  jury: "Jury",
  participant: "Participant",
};

export default function DevLoginPage() {
  // Hard gate: the page does not exist unless explicitly enabled.
  if (!isDevLoginEnabled()) {
    notFound();
  }

  const personas = getDevPersonas();
  const adminOnly = isDevLoginAdminOnly();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-xl font-bold text-text-primary">
          Hackathon simulation — dev login
        </h1>
        <p className="mb-6 text-sm text-text-secondary">
          {adminOnly
            ? "No Google auth. Sign in as the admin persona against the shared test database. Participants and jury use the normal login flows."
            : "No Google auth. Pick a persona to sign in against the shared test database. Open this page in separate browsers/profiles to act as different people at the same time."}
        </p>

        <div className="flex flex-col gap-3">
          {personas.map((persona) => (
            <form key={persona.email} action={devLoginAction}>
              <input type="hidden" name="email" value={persona.email} />
              <Button
                type="submit"
                variant={persona.role === "admin" ? "primary" : "secondary"}
                className="w-full justify-between"
              >
                <span>{persona.label}</span>
                <span className="text-xs opacity-70">
                  {ROLE_LABEL[persona.role]}
                </span>
              </Button>
            </form>
          ))}
        </div>

        <p className="mt-6 text-xs text-text-secondary">
          To reset the shared world, an operator re-runs
          <code className="mx-1 rounded bg-white/5 px-1 py-0.5">
            scripts/seed-test-via-api.ts
          </code>
          . See <code>docs/SIM.md</code>.
        </p>
      </Card>
    </div>
  );
}
