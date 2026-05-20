"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { checkInApplication } from "@/lib/actions/applications";

interface Chapter {
  id: string;
  name: string;
  status: string;
}

// Check-in is possible from screening onwards (event-day: check-in happens
// after screening is done but before status advances to registration_open)
const CHECK_IN_STATUSES = new Set(["preparation", "challenge_selection", "hacking", "submissions_open", "pitching"]);

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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [checkedInList, setCheckedInList] = useState<Array<{ id: string; first_name: string; last_name: string; email: string; checked_in_at: string }>>([]);
  const [loadingList, setLoadingList] = useState(false);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);

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

  const loadCheckedInList = useCallback(async () => {
    if (!selectedChapter) return;
    setLoadingList(true);
    try {
      const res = await fetch(`/api/admin/chapters/${selectedChapter}/applications`);
      if (res.ok) {
        const allApps = await res.json() as Array<{ id: string; firstName: string; lastName: string; email: string; status: string; checkedInAt: string | null }>;
        const checkedIn = allApps
          .filter((a) => a.status === "checked_in" && a.checkedInAt)
          .map((a) => ({ id: a.id, first_name: a.firstName, last_name: a.lastName, email: a.email, checked_in_at: a.checkedInAt! }))
          .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime());
        setCheckedInList(checkedIn);
        setCheckedInCount(checkedIn.length);
      }
    } catch { /* ignore */ }
    setLoadingList(false);
  }, [selectedChapter]);

  useEffect(() => {
    if (!selectedChapter) return;
    loadCheckedInList();
  }, [selectedChapter, loadCheckedInList]);

  // Use ref for processing state to avoid re-creating the callback
  // (which would restart the scanner effect)
  const processingRef = useRef(false);

  const processCheckIn = useCallback(
    async (token: string) => {
      if (processingRef.current || !adminUserId) return;
      processingRef.current = true;
      setProcessing(true);
      setResult(null);

      // Stop scanner after successful scan to prevent repeated calls
      setScanning(false);

      const res = await checkInApplication(token.trim(), adminUserId);

      if (res.success) {
        setResult({
          type: "success",
          message: `Checked in successfully!`,
          name: res.name,
        });
        loadCheckedInList();
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

      processingRef.current = false;
      setProcessing(false);
    },
    [adminUserId, loadCheckedInList]
  );

  // Start/stop html5-qrcode scanner
  useEffect(() => {
    if (!scanning) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    setCameraError(null);

    function handleCameraError(err: unknown) {
      console.error("Camera error:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NotAllowedError") || message.includes("Permission")) {
        setCameraError("Camera permission denied. Please allow camera access in your browser settings and try again.");
      } else if (message.includes("NotFoundError") || message.includes("no camera") || message.includes("Requested device not found")) {
        setCameraError("No camera found. Please connect a camera or use manual token entry below.");
      } else if (message.includes("NotReadableError") || message.includes("Could not start")) {
        setCameraError("Camera is in use by another application. Close other apps using the camera and try again.");
      } else {
        setCameraError(`Could not access camera: ${message}`);
      }
      setScanning(false);
    }

    async function startScanner() {
      // Wait a tick for the DOM element to render
      await new Promise((r) => setTimeout(r, 100));
      if (cancelled) return;

      // Check if the DOM element exists
      const container = document.getElementById("qr-reader");
      if (!container) {
        handleCameraError(new Error("Scanner container not found"));
        return;
      }

      let Html5Qrcode;
      try {
        const mod = await import("html5-qrcode");
        Html5Qrcode = mod.Html5Qrcode;
      } catch (err) {
        handleCameraError(err);
        return;
      }

      if (cancelled) return;

      let scanner;
      try {
        scanner = new Html5Qrcode("qr-reader");
      } catch (err) {
        handleCameraError(err);
        return;
      }
      scannerRef.current = scanner;

      const scanConfig = { fps: 10, qrbox: { width: 250, height: 250 } };
      const onSuccess = (decodedText: string) => processCheckIn(decodedText);
      const onFailure = () => {}; // Normal while scanning

      try {
        // Try back camera first (mobile), fall back to front camera (desktop)
        try {
          await scanner.start({ facingMode: "environment" }, scanConfig, onSuccess, onFailure);
        } catch {
          if (cancelled) return;
          await scanner.start({ facingMode: "user" }, scanConfig, onSuccess, onFailure);
        }
      } catch (err) {
        if (!cancelled) handleCameraError(err);
      }
    }

    startScanner().catch((err) => {
      if (!cancelled) handleCameraError(err);
    });

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scannerRef.current = null;
        // Stop the scanner gracefully, then clear after a delay
        scanner.stop().then(() => {
          try { scanner.clear(); } catch { /* ignore */ }
        }).catch(() => {
          try { scanner.clear(); } catch { /* ignore */ }
        });
      }
    };
  }, [scanning, processCheckIn]);

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
              <div className="mt-4 flex justify-center gap-3">
                <Button onClick={() => { setResult(null); setScanning(true); }}>
                  Scan Next
                </Button>
                <button
                  onClick={() => setResult(null)}
                  className="text-sm ad-text-muted hover:ad-text-secondary transition-colors px-3 py-2"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Scanner - only on mobile/tablet (touch devices with cameras) */}
          <Card className="mt-6">
            <h2 className="ad-heading mb-4 text-lg">QR Scanner</h2>
            {cameraError && (
              <div className="mb-4 rounded-lg border ad-border-error ad-bg-error p-4 text-sm ad-text-error">
                {cameraError}
              </div>
            )}
            {scanning ? (
              <div className="space-y-4">
                <div id="qr-reader" className="mx-auto max-w-sm overflow-hidden rounded-xl" style={{ minHeight: 300 }} />
                {!cameraError && (
                  <p className="text-center text-xs ad-text-muted">Point camera at QR code...</p>
                )}
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
                <Button onClick={() => { setCameraError(null); setScanning(true); }}>
                  Start Scanner
                </Button>
              </div>
            )}
          </Card>

          {/* Manual entry */}
          <Card className="mt-6">
            <h2 className="ad-heading mb-4 text-lg">Manual Entry</h2>
            <p className="mb-4 text-sm ad-text-muted">
              Enter a check-in token manually (for desktop or if QR scanning fails).
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

          {/* Checked-in participants list */}
          <Card className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="ad-heading text-lg">Checked-in Participants</h2>
              <Button variant="secondary" onClick={loadCheckedInList} disabled={loadingList}>
                {loadingList ? "Loading..." : "Refresh"}
              </Button>
            </div>
            {checkedInList.length === 0 ? (
              <p className="text-center ad-text-muted text-sm py-4">
                {loadingList ? "Loading..." : "No participants checked in yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b ad-border">
                      <th className="text-left py-2 px-3 font-medium ad-text-muted">#</th>
                      <th className="text-left py-2 px-3 font-medium ad-text-muted">Name</th>
                      <th className="text-left py-2 px-3 font-medium ad-text-muted">Email</th>
                      <th className="text-left py-2 px-3 font-medium ad-text-muted">Checked in at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkedInList.map((p, i) => (
                      <tr key={p.id} className="border-b ad-border last:border-0">
                        <td className="py-2 px-3 ad-text-muted">{i + 1}</td>
                        <td className="py-2 px-3 ad-text font-medium">{p.first_name} {p.last_name}</td>
                        <td className="py-2 px-3 ad-text-secondary">{p.email}</td>
                        <td className="py-2 px-3 ad-text-muted text-xs">{new Date(p.checked_in_at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

