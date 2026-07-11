"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Variant = "participation" | "achievement";

const VARIANTS: { key: Variant; title: string; description: string }[] = [
  {
    key: "participation",
    title: "Participation Certificates",
    description:
      "Background for all participation certificates (team and personal, including the neutral ones placed teams can download).",
  },
  {
    key: "achievement",
    title: "Achievement Certificates",
    description:
      "Background for the certificates of teams placed 1st to 5th (shows placement and points).",
  },
];

function DesignSlot({ chapterId, variant }: { chapterId: string; variant: (typeof VARIANTS)[number] }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiUrl = `/api/admin/chapters/${chapterId}/certificate-design?variant=${variant.key}`;

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch(apiUrl);
      if (res.status === 404) {
        // No design uploaded: the expected empty state, not an error.
        setPreviewUrl(null);
        return;
      }
      if (!res.ok) {
        setPreviewUrl(null);
        setError("Could not load the design preview. Reload the page to retry.");
        return;
      }
      const blob = await res.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setPreviewUrl(null);
      setError("Could not load the design preview: network error.");
    }
  }, [apiUrl]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Revoke the previous object URL whenever the preview changes, and the last
  // one on unmount, so replaced previews don't leak multi-MB blobs.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("variant", variant.key);
      formData.append("file", file);
      const res = await fetch(apiUrl.split("?")[0], { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Upload failed.");
        return;
      }
      await loadPreview();
    } catch {
      setError("Upload failed: network error. Please try again.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove the custom ${variant.title.toLowerCase()} design? Certificates fall back to the default EHL design.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Removing the design failed.");
        return;
      }
      setPreviewUrl(null);
    } catch {
      setError("Removing the design failed: network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="ad-heading text-lg">{variant.title}</h2>
      <p className="mt-1 text-sm ad-text-secondary">{variant.description}</p>

      <div className="mt-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob object URL preview
          <img
            src={previewUrl}
            alt={`${variant.title} background design`}
            className="w-full max-w-lg rounded-lg border ad-border object-contain"
          />
        ) : (
          <div className="flex h-40 w-full max-w-lg items-center justify-center rounded-lg border border-dashed ad-border">
            <p className="text-sm ad-text-muted">
              No custom design uploaded. The default EHL design is used.
            </p>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <Button
          size="sm"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? "Working..." : previewUrl ? "Replace Design" : "Upload Design"}
        </Button>
        {previewUrl && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={handleRemove}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}

export function CertificateDesignsManager({ chapterId }: { chapterId: string }) {
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="ad-heading text-lg">How it works</h2>
        <p className="mt-1 text-sm ad-text-secondary">
          Upload a full-page background image per certificate type, for example with
          sponsor logos. Certificate text (names, placement, match details) is placed
          on top at fixed positions. Use the design template to see which areas must
          stay free. PNG or JPEG, max 5MB, recommended 2384x1684 px (A4 landscape at
          200 dpi). Without an upload, certificates use the default EHL design.
        </p>
        <a
          href="/api/admin/certificate-design-template"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm font-medium text-purple hover:underline"
        >
          Download design template (PDF)
        </a>
      </Card>

      {VARIANTS.map((variant) => (
        <DesignSlot key={variant.key} chapterId={chapterId} variant={variant} />
      ))}
    </div>
  );
}
