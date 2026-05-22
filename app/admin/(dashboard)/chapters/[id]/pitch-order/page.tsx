"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { generatePitchOrder } from "@/lib/actions/admin";

interface Challenge {
  id: string;
  title: string;
  sponsorName: string | null;
}

interface PitchOrderData {
  challengeId: string;
  orderList: string[];
}

interface Team {
  id: string;
  name: string;
}

export default function AdminPitchOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [chapterId, setChapterId] = useState("");
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [pitchOrders, setPitchOrders] = useState<Record<string, string[]>>({});
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    params.then(async ({ id }) => {
      setChapterId(id);
      const [challengesRes, teamsRes] = await Promise.all([
        fetch(`/api/admin/chapters/${id}/challenges`).then((r) => r.json()),
        fetch(`/api/admin/teams`).then((r) => r.json()),
      ]);
      setChallenges(challengesRes);
      setTeams(teamsRes);

      // Load pitch orders
      const orders: Record<string, string[]> = {};
      for (const challenge of challengesRes) {
        const res = await fetch(`/api/admin/challenges/${challenge.id}/pitch-order`).then(r => r.json()).catch(() => null);
        if (res?.orderList) {
          orders[challenge.id] = res.orderList;
        }
      }
      setPitchOrders(orders);
      setLoading(false);
    });
  }, [params]);

  async function handleGenerate(challengeId: string) {
    setGenerating(challengeId);
    const result = await generatePitchOrder(challengeId);
    if (result.order) {
      setPitchOrders((prev) => ({ ...prev, [challengeId]: result.order! }));
    }
    setGenerating(null);
  }

  function getTeamName(teamId: string): string {
    return teams.find((t) => t.id === teamId)?.name || "Unknown";
  }

  if (loading) {
    return <div><p className="ad-text-muted">Loading...</p></div>;
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to Chapter
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Pitch Order</h1>
      <p className="mt-1 ad-text-secondary">
        Generate random pitch orders per challenge.
      </p>

      <div className="mt-8 space-y-6">
        {challenges.map((challenge) => {
          const order = pitchOrders[challenge.id];
          const isGenerating = generating === challenge.id;

          return (
            <Card key={challenge.id}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="ad-heading text-lg">{challenge.title}</h3>
                  {challenge.sponsorName && (
                    <p className="text-sm ad-text-muted">by {challenge.sponsorName}</p>
                  )}
                </div>
                <Button
                  onClick={() => handleGenerate(challenge.id)}
                  disabled={isGenerating}
                >
                  {isGenerating
                    ? "Generating..."
                    : order
                      ? "Regenerate"
                      : "Generate Order"}
                </Button>
              </div>

              {order && (
                <div className="mt-4 space-y-2">
                  {order.map((teamId, index) => (
                    <div
                      key={teamId}
                      className="flex items-center gap-3 rounded-lg border ad-border px-4 py-2.5"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full ad-bg-accent font-mono text-xs font-bold ad-text-link">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium">{getTeamName(teamId)}</span>
                    </div>
                  ))}
                </div>
              )}

              {!order && (
                <p className="mt-4 text-sm ad-text-muted">
                  No pitch order generated yet.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
