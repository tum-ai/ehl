"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { updateChapterDetails } from "@/lib/actions/admin";
import { adminUpload } from "@/lib/upload";

interface ChapterEditFormProps {
  chapterId: string;
  initialData: {
    name: string;
    city: string;
    country: string;
    description: string;
    date: string | null;
    dateEnd: string | null;
    heroImageUrl: string | null;
    photoAlbumUrl: string | null;
    challengeRegistrationEnabled: boolean;
    requireCv: boolean;
    requireMotivation: boolean;
    applicationDeadline: string | null;
    challengeSelectionDeadline: string | null;
    submissionDeadline: string | null;
  };
  onSaved?: () => void;
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ChapterEditForm({ chapterId, initialData, onSaved }: ChapterEditFormProps) {
  const [name, setName] = useState(initialData.name);
  const [city, setCity] = useState(initialData.city);
  const [country, setCountry] = useState(initialData.country);
  const [description, setDescription] = useState(initialData.description);
  const [heroUrl, setHeroUrl] = useState(initialData.heroImageUrl);
  const [photoAlbumUrl, setPhotoAlbumUrl] = useState(initialData.photoAlbumUrl || "");
  const [challengeRegEnabled, setChallengeRegEnabled] = useState(initialData.challengeRegistrationEnabled);
  const [requireCv, setRequireCv] = useState(initialData.requireCv);
  const [requireMotivation, setRequireMotivation] = useState(initialData.requireMotivation);
  const [appDeadline, setAppDeadline] = useState(toLocalDatetime(initialData.applicationDeadline));
  const [csDeadline, setCsDeadline] = useState(toLocalDatetime(initialData.challengeSelectionDeadline));
  const [subDeadline, setSubDeadline] = useState(toLocalDatetime(initialData.submissionDeadline));

  // Date mode
  const isCurrentlyApprox = (() => {
    if (!initialData.date) return true;
    const d = new Date(initialData.date + "T00:00:00");
    return d.getDate() === 1;
  })();

  const [dateMode, setDateMode] = useState<"approximate" | "exact">(
    isCurrentlyApprox ? "approximate" : "exact"
  );
  const [month, setMonth] = useState(() => {
    if (!initialData.date) return "";
    const d = new Date(initialData.date + "T00:00:00");
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [startDate, setStartDate] = useState(() => {
    if (!initialData.date || isCurrentlyApprox) return "";
    return initialData.date;
  });
  const [endDate, setEndDate] = useState(initialData.dateEnd || "");

  // Hero image upload
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Track if anything changed
  const hasChanges = (() => {
    const computedDate = dateMode === "approximate"
      ? (month ? `${month}-01` : null)
      : (startDate || null);
    const computedDateEnd = dateMode === "approximate" ? null : (endDate || null);

    return (
      name !== initialData.name ||
      city !== initialData.city ||
      country !== initialData.country ||
      description !== initialData.description ||
      heroUrl !== initialData.heroImageUrl ||
      (photoAlbumUrl || null) !== (initialData.photoAlbumUrl || null) ||
      computedDate !== initialData.date ||
      computedDateEnd !== initialData.dateEnd ||
      challengeRegEnabled !== initialData.challengeRegistrationEnabled ||
      requireCv !== initialData.requireCv ||
      requireMotivation !== initialData.requireMotivation ||
      appDeadline !== toLocalDatetime(initialData.applicationDeadline) ||
      csDeadline !== toLocalDatetime(initialData.challengeSelectionDeadline) ||
      subDeadline !== toLocalDatetime(initialData.submissionDeadline)
    );
  })();

  async function handleHeroUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "Only image files are allowed." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "File exceeds 5MB limit." });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bucket", "hero-images");

      const result = await adminUpload(formData);
      if (result.error) {
        setMessage({ type: "error", text: result.error });
      } else if (result.url) {
        setHeroUrl(result.url);
      }
    } catch {
      setMessage({ type: "error", text: "Upload failed." });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    let date: string | null = null;
    let dateEnd: string | null = null;

    if (dateMode === "approximate") {
      date = month ? `${month}-01` : null;
    } else {
      date = startDate || null;
      dateEnd = endDate || null;
    }

    const result = await updateChapterDetails(chapterId, {
      name,
      city,
      country,
      description,
      date,
      dateEnd,
      heroImageUrl: heroUrl,
      photoAlbumUrl: photoAlbumUrl || null,
      challengeRegistrationEnabled: challengeRegEnabled,
      requireCv,
      requireMotivation,
      applicationDeadline: appDeadline ? new Date(appDeadline).toISOString() : null,
      challengeSelectionDeadline: csDeadline ? new Date(csDeadline).toISOString() : null,
      submissionDeadline: subDeadline ? new Date(subDeadline).toISOString() : null,
    });

    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Chapter saved." });
      setTimeout(() => setMessage(null), 3000);
      onSaved?.();
    }
    setSaving(false);
  }

  return (
    <Card>
      <h2 className="mb-4 ad-heading text-lg">Details</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm ad-text-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm ad-text-muted">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm ad-text-muted">Country</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
            />
          </div>
        </div>

        {/* Date section */}
        <div>
          <label className="block text-sm ad-text-muted">Date</label>
          <div className="mt-2 flex rounded-lg border ad-border p-0.5">
            <button
              type="button"
              onClick={() => setDateMode("approximate")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                dateMode === "approximate"
                  ? "ad-bg-accent ad-text-link"
                  : "ad-text-muted hover:ad-text-secondary"
              }`}
            >
              Approximate (Month)
            </button>
            <button
              type="button"
              onClick={() => setDateMode("exact")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                dateMode === "exact"
                  ? "ad-bg-accent ad-text-link"
                  : "ad-text-muted hover:ad-text-secondary"
              }`}
            >
              Exact Dates
            </button>
          </div>

          {dateMode === "approximate" ? (
            <div className="mt-3">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
              <p className="mt-1 text-xs ad-text-muted">
                Used for early announcements. Shows as &quot;June 2026&quot; etc.
              </p>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs ad-text-muted mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs ad-text-muted mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                />
              </div>
              <p className="col-span-2 text-xs ad-text-muted">
                Required before opening applications. End date is optional for single-day events.
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm ad-text-muted">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none resize-none"
          />
        </div>

        {/* Hero image */}
        <div className="border-t ad-border pt-4">
          <label className="block text-sm ad-text-muted">Hero Image</label>
          {heroUrl && (
            <div className="mt-2">
              <div className="relative h-32 w-full overflow-hidden rounded-lg">
                <Image
                  src={heroUrl}
                  alt="Hero image"
                  fill
                  className="object-cover"
                />
              </div>
              <button
                onClick={() => setHeroUrl(null)}
                type="button"
                className="mt-2 text-sm ad-text-error hover:underline"
              >
                Remove
              </button>
            </div>
          )}
          <div className="mt-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleHeroUpload}
              disabled={uploading}
              className="block w-full text-sm ad-text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-purple-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-purple-700 file:cursor-pointer hover:file:bg-purple-100 disabled:opacity-50"
            />
            {uploading && (
              <p className="mt-1 text-xs ad-text-muted">Uploading...</p>
            )}
          </div>
        </div>

        {/* Photo album URL */}
        <div className="border-t ad-border pt-4">
          <label className="block text-sm ad-text-muted">Photo Album URL</label>
          <input
            type="url"
            value={photoAlbumUrl}
            onChange={(e) => setPhotoAlbumUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text placeholder:ad-text-muted/50 focus:outline-none"
          />
        </div>

        {/* Deadlines */}
        <div className="border-t ad-border pt-4">
          <label className="block text-sm font-medium ad-text mb-3">Deadlines</label>
          <div className="space-y-4">
            <div>
              <label className="block text-sm ad-text-muted mb-1">Application Deadline</label>
              <input
                type="datetime-local"
                value={appDeadline}
                onChange={(e) => setAppDeadline(e.target.value)}
                className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
              <p className="mt-1 text-xs ad-text-muted">
                Required before opening applications. Applications close automatically at this time.
              </p>
            </div>
            <div>
              <label className="block text-sm ad-text-muted mb-1">Challenge Selection Deadline</label>
              <input
                type="datetime-local"
                value={csDeadline}
                onChange={(e) => setCsDeadline(e.target.value)}
                className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
              <p className="mt-1 text-xs ad-text-muted">
                Required before opening challenge selection. Teams must pick a challenge before this time.
              </p>
            </div>
            <div>
              <label className="block text-sm ad-text-muted mb-1">Submission Deadline</label>
              <input
                type="datetime-local"
                value={subDeadline}
                onChange={(e) => setSubDeadline(e.target.value)}
                className="w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
              <p className="mt-1 text-xs ad-text-muted">
                Required before opening submissions. Submissions lock automatically at this time.
              </p>
            </div>
          </div>
        </div>

        {/* Challenge registration toggle */}
        <div className="border-t ad-border pt-4">
          <Toggle
            checked={challengeRegEnabled}
            onChange={setChallengeRegEnabled}
            label="Challenge Registration Enabled"
            description="When enabled, team presidents can select a challenge at the event."
          />
        </div>

        {/* Application requirements. These gate the PUBLIC apply form only: the
            event-day walk-in form keeps the CV optional and never shows the
            motivation question. */}
        <div className="border-t ad-border pt-4 space-y-4">
          <Toggle
            checked={requireCv}
            onChange={setRequireCv}
            label="Require CV"
            description="Applicants must upload a PDF CV to submit. Public application form only, not walk-in registration."
          />
          <Toggle
            checked={requireMotivation}
            onChange={setRequireMotivation}
            label="Require Motivation Answer"
            description={'Adds a required question: "What motivated you to apply for this hackathon, and what do you hope to get out of it?"'}
          />
        </div>
      </div>

      {/* Save button + message */}
      {message && (
        <p
          className={`mt-4 rounded-lg px-4 py-2.5 text-sm ${
            message.type === "error"
              ? "ad-bg-error ad-text-error"
              : "ad-bg-success ad-text-success"
          }`}
        >
          {message.text}
        </p>
      )}
      <button
        onClick={handleSave}
        disabled={saving || !hasChanges}
        className="mt-6 w-full rounded-lg bg-gradient-to-r from-gold to-gold-dark px-6 py-3 text-sm font-bold text-surface-deep transition-all hover:shadow-[0_0_20px_rgba(255,204,106,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? "Saving..." : hasChanges ? "Save Changes" : "No Changes"}
      </button>
    </Card>
  );
}
