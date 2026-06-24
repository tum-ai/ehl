"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminUpload } from "@/lib/upload";
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes";

interface Partner {
  id: string;
  name: string;
  logoUrl: string;
  url: string;
  tier: string;
  description: string | null;
  displayOrder: number;
  chapterId: string | null;
}

interface Chapter {
  id: string;
  name: string;
  city: string;
  matchNumber: number;
  isFinale: boolean;
}

const TIERS = ["challenge_partner", "tech_partner", "community_partner"];

export default function AdminPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form fields
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tier, setTier] = useState("challenge_partner");
  const [description, setDescription] = useState("");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);

  // Warn before leaving with an open, partly-filled partner form (no draft
  // persistence, so anything typed is lost on navigation).
  const formDirty =
    showForm &&
    (name.trim() !== "" ||
      url.trim() !== "" ||
      description.trim() !== "" ||
      logoUrl !== "" ||
      selectedChapterIds.length > 0 ||
      tier !== "challenge_partner");
  useUnsavedChanges(formDirty);

  useEffect(() => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then((data) => {
        setPartners(data.partners ?? []);
        setChapters(data.chapters ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function getChapterLabel(chapterId: string | null): string {
    if (!chapterId) return "Global";
    const ch = chapters.find((c) => c.id === chapterId);
    if (!ch) return "Unknown";
    return ch.isFinale ? "Grand Finale" : ch.city;
  }

  function toggleChapter(chapterId: string) {
    setSelectedChapterIds((prev) =>
      prev.includes(chapterId)
        ? prev.filter((id) => id !== chapterId)
        : [...prev, chapterId]
    );
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setError("File size must be under 50MB.");
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("bucket", "partner-logos");

    try {
      const result = await adminUpload(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.url) {
        setLogoUrl(result.url);
        setLogoPreview(URL.createObjectURL(file));
      }
    } catch {
      setError("Upload failed.");
    }
    setUploading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !logoUrl) {
      setError("Name and logo are required.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          logoUrl,
          url,
          tier,
          description,
          chapterIds: selectedChapterIds.length > 0 ? selectedChapterIds : undefined,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setPartners((prev) => [...prev, ...(data.partners ?? [])]);
        resetForm();
      }
    } catch {
      setError("Failed to create partner.");
    }
    setSaving(false);
  }

  function resetForm() {
    setName("");
    setUrl("");
    setTier("challenge_partner");
    setDescription("");
    setLogoUrl("");
    setLogoPreview(null);
    setSelectedChapterIds([]);
    setShowForm(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(partnerId: string) {
    if (!confirm("Remove this partner?")) return;

    const res = await fetch(`/api/admin/partners?id=${partnerId}`, {
      method: "DELETE",
    });
    const data = await res.json();

    if (!data.error) {
      setPartners((prev) => prev.filter((p) => p.id !== partnerId));
    }
  }

  if (loading) {
    return <div><p className="ad-text-muted">Loading...</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Partners</h1>
          <p className="mt-1 ad-text-secondary">
            Manage sponsors and partners
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Add Partner"}
        </Button>
      </div>

      {/* Add partner form */}
      {showForm && (
        <Card className="mt-6">
          <h2 className="ad-heading text-lg">New Partner</h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm ad-text-muted">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Partner name"
                  className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm ad-text-muted">Website URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://partner.com"
                  className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm ad-text-muted">Tier</label>
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm ad-text-muted">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                />
              </div>
            </div>

            {/* Chapter assignment */}
            <div>
              <label className="block text-sm ad-text-muted">
                Chapters <span className="text-xs">(leave empty for global partner)</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {chapters.map((ch) => {
                  const selected = selectedChapterIds.includes(ch.id);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => toggleChapter(ch.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "ad-border ad-text-muted hover:bg-gray-50"
                      }`}
                    >
                      {ch.isFinale ? "Grand Finale" : `Match ${ch.matchNumber}: ${ch.city}`}
                    </button>
                  );
                })}
              </div>
              {selectedChapterIds.length > 0 && (
                <p className="mt-1.5 text-xs ad-text-muted">
                  {selectedChapterIds.length} chapter{selectedChapterIds.length !== 1 ? "s" : ""} selected.
                  One entry per chapter will be created. Deduplicated on public pages.
                </p>
              )}
            </div>

            {/* Logo upload */}
            <div>
              <label className="block text-sm ad-text-muted">Logo</label>
              <div className="mt-1 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded-lg border border-dashed ad-border px-4 py-3 text-sm ad-text-muted transition-colors"
                >
                  {uploading ? "Uploading..." : logoPreview ? "Change logo" : "Upload logo"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.svg"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                {logoPreview && (
                  <div className="flex h-12 w-24 items-center justify-center rounded-lg ad-bg-elevated p-2">
                    <Image
                      src={logoPreview}
                      alt="Logo preview"
                      width={80}
                      height={40}
                      className="h-8 w-auto object-contain"
                    />
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-sm ad-text-error">{error}</p>}

            <Button type="submit" disabled={saving || !logoUrl}>
              {saving ? "Saving..." : "Add Partner"}
            </Button>
          </form>
        </Card>
      )}

      {/* Partners list */}
      <div className="mt-8 space-y-3">
        {partners.map((partner) => (
          <Card key={partner.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-20 items-center justify-center rounded-lg ad-bg-elevated p-2">
                  <Image
                    src={partner.logoUrl}
                    alt={partner.name}
                    width={80}
                    height={40}
                    className="h-8 w-auto object-contain"
                  />
                </div>
                <div>
                  <p className="font-medium">{partner.name}</p>
                  <div className="flex items-center gap-2">
                    {partner.url && (
                      <a
                        href={partner.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs ad-text-link transition-colors"
                      >
                        {partner.url}
                      </a>
                    )}
                    <span className="text-xs ad-text-muted">
                      {getChapterLabel(partner.chapterId)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="default" light>{partner.tier.replace(/_/g, " ")}</Badge>
                <button
                  onClick={() => handleDelete(partner.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium ad-text-error hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </Card>
        ))}

        {partners.length === 0 && (
          <Card>
            <p className="text-center ad-text-muted">No partners yet.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
