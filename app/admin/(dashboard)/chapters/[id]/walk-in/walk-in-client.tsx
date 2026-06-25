"use client";

import { useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Card } from "@/components/ui/card";
import { rotateWalkInToken } from "@/lib/actions/walk-in";

interface Props {
  chapterId: string;
  chapterName: string;
  walkInUrl: string;
  qrDataUrl: string;
}

const btnClass =
  "rounded-lg bg-gradient-to-r from-gold to-gold-dark px-6 py-3 text-sm font-bold text-surface-deep transition-all hover:shadow-[0_0_20px_rgba(255,204,106,0.2)] disabled:opacity-40 disabled:cursor-not-allowed";

export function WalkInClient({ chapterId, chapterName, walkInUrl, qrDataUrl }: Props) {
  // The base ("…/walk-in/") comes from the URL the server already built with the
  // authoritative getSiteUrl(), so the rotated URL can't drift from it on the client.
  const baseUrl = walkInUrl.replace(/[^/]+$/, "");
  const [url, setUrl] = useState(walkInUrl);
  const [qr, setQr] = useState(qrDataUrl);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus({ ok: false, text: "Could not copy. Select the link and copy manually." });
    }
  }

  async function handleRotate() {
    const confirmed = window.confirm(
      "Rotate the walk-in token? Any printed QR codes will stop working and you will need to print the new one."
    );
    if (!confirmed) return;

    setRotating(true);
    setStatus(null);
    const result = await rotateWalkInToken(chapterId);
    if ("error" in result) {
      setStatus({ ok: false, text: result.error });
      setRotating(false);
      return;
    }

    const newUrl = `${baseUrl}${result.token}`;
    setUrl(newUrl);
    try {
      const dataUrl = await QRCode.toDataURL(newUrl, {
        width: 600,
        margin: 1,
        color: { dark: "#0B0B1A", light: "#FFFFFF" },
      });
      setQr(dataUrl);
    } catch {
      // Keep the old QR image; the new link is still usable manually.
    }
    setStatus({ ok: true, text: "Token rotated. Print the new QR code." });
    setRotating(false);
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to chapter
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Walk-In Registration</h1>
      <p className="mt-1 ad-text-secondary">{chapterName}</p>

      <Card className="mt-6">
        <h2 className="ad-heading mb-2 text-lg">Walk-In QR Code</h2>
        <p className="ad-text-secondary text-sm">
          Print this and place it at the registration desk. A walk-in scans it, fills the
          application form on their phone, and creates an account in one step. They are
          accepted automatically; check them in with the normal personal check-in QR.
        </p>

        <div className="mt-6 flex flex-col items-center print:mt-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="Walk-in registration QR code"
            className="h-72 w-72 rounded-lg border ad-border bg-white p-3"
          />
          <p className="mt-4 break-all text-center font-mono text-xs ad-text-muted">{url}</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 print:hidden">
          <button type="button" onClick={() => window.print()} className={btnClass}>
            Print
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg border ad-border px-6 py-3 text-sm font-bold transition-colors ad-bg-card-hover"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={handleRotate}
            disabled={rotating}
            className="rounded-lg border border-error/30 px-6 py-3 text-sm font-bold text-error transition-colors hover:bg-error/5 disabled:opacity-40"
          >
            {rotating ? "Rotating..." : "Rotate token"}
          </button>
        </div>

        {status && (
          <p
            className={`mt-3 rounded-lg px-4 py-2 text-sm print:hidden ${
              status.ok ? "ad-bg-success ad-text-success" : "ad-bg-error ad-text-error"
            }`}
          >
            {status.text}
          </p>
        )}
      </Card>
    </div>
  );
}
