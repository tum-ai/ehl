"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { checkInApplication } from "@/lib/actions/applications";
import dynamic from "next/dynamic";

const Scanner = dynamic(
  () => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner),
  { ssr: false }
);

interface Chapter {
  id: string;
  name: string;
  status: string;
}

// Check-in is only possible during these phases
const CHECK_IN_STATUSES = new Set(["registration_open", "hacking", "submissions_open"]);

interface CheckInResult {
  type: "success" | "error" | "warning";
  message: string;
  name?: string;
}

export default function AdminCheckInPage() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState("");
  const [scanning, setScanning] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [adminUserId, setAdminUserId] = useState("");

  const checkInChapters = chapters.filter((ch) => CHECK_IN_STATUSES.has(ch.status));

  useEffect(() => {
    // Load chapters (filtered to check-in eligible phases)
    fetch("/api/admin/jury/chapters")
      .then((r) => r.json())
      .then((all: Chapter[]) => setChapters(all))
      .catch(() => {});

    // Get admin user ID from session
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user?.id) setAdminUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedChapter) return;
    // Load checked-in count
    fetch(`/api/admin/chapters/${selectedChapter}/applications/stats`)
      .then((r) => r.json())
      .then((stats) => setCheckedInCount(stats.checkedIn || 0))
      .catch(() => {});
  }, [selectedChapter]);

  const processCheckIn = useCallback(
    async (token: string) => {
      if (processing || !adminUserId) return;
      setProcessing(true);
      setResult(null);

      const res = await checkInApplication(token.trim(), adminUserId);

      if (res.success) {
        setResult({
          type: "success",
          message: `Checked in successfully!`,
          name: res.name,
        });
        setCheckedInCount((c) => c + 1);
      } else if (res.error?.includes("Already checked in")) {
        setResult({
          type: "warning",
          message: res.error,
          name: res.name,
        });
      } else {
        setResult({
          type: "error",
          message: res.error || "Check-in failed.",
          name: res.name,
        });
      }

      setProcessing(false);
    },
    [processing, adminUserId]
  );

  function handleScan(detectedCodes: Array<{ rawValue: string }>) {
    if (detectedCodes.length === 0 || processing) return;
    const token = detectedCodes[0].rawValue;
    if (token) {
      processCheckIn(token);
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualToken.trim()) return;
    processCheckIn(manualToken);
    setManualToken("");
  }

  return (
    <div>
      <h1 className="ad-title text-2xl">QR Check-in</h1>
      <p className="mt-1 ad-text-secondary">
        Scan participant QR codes to check them in at the event.
      </p>

      {/* Chapter selector */}
      <Card className="mt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-4">
            <label className="text-sm font-medium ad-text-muted shrink-0">
              Chapter:
            </label>
            <select
              value={selectedChapter}
              onChange={(e) => {
                setSelectedChapter(e.target.value);
                setResult(null);
              }}
              className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 text-sm ad-text focus:outline-none sm:max-w-md"
            >
              <option value="">Select a chapter...</option>
              {checkInChapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>
          {selectedChapter && (
            <div className="flex items-center gap-2">
              <Badge variant="live" light>
                {checkedInCount} checked in
              </Badge>
            </div>
          )}
        </div>
      </Card>

      {!selectedChapter ? (
        <Card className="mt-6">
          {checkInChapters.length === 0 && chapters.length > 0 ? (
            <p className="text-center ad-text-muted">
              No chapters are currently in the check-in phase. Check-in is available during Registration Open and Hacking.
            </p>
          ) : (
            <p className="text-center ad-text-muted">
              Select a chapter to start scanning.
            </p>
          )}
        </Card>
      ) : (
        <>
          {/* Result display */}
          {result && (
            <div
              className={`mt-6 rounded-2xl border p-6 text-center ${
                result.type === "success"
                  ? "ad-border-success ad-bg-success"
                  : result.type === "warning"
                    ? "ad-border-warning ad-bg-warning"
                    : "ad-border-error ad-bg-error"
              }`}
            >
              <div className="mb-2 text-4xl">
                {result.type === "success"
                  ? "\u2705"
                  : result.type === "warning"
                    ? "\u26A0\uFE0F"
                    : "\u274C"}
              </div>
              {result.name && (
                <p className="text-xl font-bold">{result.name}</p>
              )}
              <p
                className={`mt-1 text-sm ${
                  result.type === "success"
                    ? "ad-text-success"
                    : result.type === "warning"
                      ? "ad-text-warning"
                      : "ad-text-error"
                }`}
              >
                {result.message}
              </p>
              <button
                onClick={() => setResult(null)}
                className="mt-4 text-sm ad-text-muted hover:ad-text-secondary transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Scanner */}
          <Card className="mt-6">
            <h2 className="ad-heading mb-4 text-lg">Camera Scanner</h2>
            {scanning ? (
              <div className="space-y-4">
                <div className="mx-auto max-w-sm overflow-hidden rounded-xl">
                  <Scanner
                    onScan={handleScan}
                    onError={(err) =>
                      console.error("Scanner error:", err)
                    }
                    formats={["qr_code"]}
                    scanDelay={1500}
                    components={{ finder: true }}
                    styles={{
                      container: {
                        width: "100%",
                        aspectRatio: "1",
                      },
                    }}
                  />
                </div>
                <div className="text-center">
                  <Button
                    variant="secondary"
                    onClick={() => setScanning(false)}
                  >
                    Stop Scanner
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="mb-4 text-sm ad-text-muted">
                  Use your device camera to scan participant QR codes.
                </p>
                <Button onClick={() => setScanning(true)}>
                  Start Scanner
                </Button>
              </div>
            )}
          </Card>

          {/* Manual entry */}
          <Card className="mt-6">
            <h2 className="ad-heading mb-4 text-lg">Manual Entry</h2>
            <p className="mb-4 text-sm ad-text-muted">
              Enter a check-in token manually if the QR code cannot be scanned.
            </p>
            <form
              onSubmit={handleManualSubmit}
              className="flex gap-3"
            >
              <input
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Enter check-in token (UUID)..."
                className="flex-1 rounded-lg ad-border ad-bg-input px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none font-mono"
              />
              <Button type="submit" disabled={processing || !manualToken.trim()}>
                {processing ? "Checking..." : "Check In"}
              </Button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
