"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { resolveJoinRequest } from "@/lib/actions/event";

interface JoinRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: string;
}

interface JoinRequestManagerProps {
  requests: JoinRequest[];
  onResolved: () => void;
}

export function JoinRequestManager({ requests, onResolved }: JoinRequestManagerProps) {
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve(requestId: string, approved: boolean) {
    setActing(requestId);
    setError(null);

    const result = await resolveJoinRequest(requestId, approved);
    if (result.error) {
      setError(result.error);
    } else {
      onResolved();
    }
    setActing(null);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h3 className="font-bold">Join Requests</h3>
        <span className="rounded-full bg-purple/20 px-2 py-0.5 text-xs font-bold text-purple-light">
          {requests.length}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-error/20 bg-error/5 p-3">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {requests.map((req) => (
          <div
            key={req.id}
            className="flex items-center justify-between rounded-lg border border-white/10 p-3"
          >
            <div>
              <p className="font-medium">{req.userName}</p>
              <p className="text-sm text-text-muted">{req.userEmail}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleResolve(req.id, true)}
                disabled={acting === req.id}
                className="bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleResolve(req.id, false)}
                disabled={acting === req.id}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
