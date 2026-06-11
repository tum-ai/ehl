"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { acceptTeamInvite } from "@/lib/actions/teams";

/**
 * Explicit confirmation step for accepting a team invite. Accepting is a
 * state change (and may remove the user from their current team), so it must
 * happen on a deliberate click, never as a side effect of opening the link.
 */
export function ConfirmInvite({
  token,
  teamName,
  onAnotherTeam,
}: {
  token: string;
  teamName: string;
  onAnotherTeam: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    setLoading(true);
    const result = await acceptTeamInvite(token);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <Section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-md text-center">
        <h1 className="text-2xl font-black">Join {teamName}?</h1>
        <p className="mt-3 text-text-secondary">
          You have been invited to join{" "}
          <strong className="text-gold">{teamName}</strong> in the European
          Hackathon League.
        </p>
        {onAnotherTeam && (
          <div className="mt-5 rounded-lg border border-gold/30 bg-gold/5 p-4 text-left">
            <p className="text-sm text-gold">
              You are currently on another team. Accepting this invite will
              remove you from your current team.
            </p>
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-lg border border-error/20 bg-error/5 p-3">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={handleAccept} disabled={loading}>
            {loading ? "Joining..." : `Join ${teamName}`}
          </Button>
          <Button variant="secondary" onClick={() => router.push("/dashboard")} disabled={loading}>
            Not now
          </Button>
        </div>
      </div>
    </Section>
  );
}
