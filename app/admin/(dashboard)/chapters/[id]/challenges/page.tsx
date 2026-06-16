"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { createChallenge, updateChallenge, deleteChallenge } from "@/lib/actions/admin";
import { adminUpload } from "@/lib/upload";
import type { SubmissionFieldConfig, CodeReviewConfig } from "@/lib/types";

interface Challenge {
  id: string;
  title: string;
  description: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  prizeDescription: string | null;
  judgingCriteria: string | null;
  submissionFields: SubmissionFieldConfig[];
  codeReviewEnabled: boolean;
  codeReviewInstructions: string | null;
  isScored: boolean;
  inviteJuryToForks: boolean;
  entireRequired: boolean;
  displayOrder: number;
  briefFileId: string | null;
  codeReviewConfig: CodeReviewConfig | null;
}

const DEFAULT_FIELDS: SubmissionFieldConfig[] = [
  { key: "deck", label: "Pitch Deck", type: "file", required: true, accept: ".pdf,.pptx" },
  { key: "repo", label: "GitHub Repository", type: "repo", required: true, repoAccess: "any" },
  { key: "demo", label: "Live Demo", type: "url", required: false },
];

function FieldEditor({
  fields,
  onChange,
}: {
  fields: SubmissionFieldConfig[];
  onChange: (fields: SubmissionFieldConfig[]) => void;
}) {
  function addField() {
    onChange([...fields, { key: "", label: "", type: "url", required: false }]);
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function updateField(index: number, patch: Partial<SubmissionFieldConfig>) {
    const updated = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(updated);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium ad-text-muted">Submission Fields</label>
        <button
          type="button"
          onClick={addField}
          className="text-xs ad-text-gold hover:underline"
        >
          + Add Field
        </button>
      </div>
      {fields.map((field, i) => (
        <div key={i} className="rounded-lg ad-border p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input
              value={field.key}
              onChange={(e) => updateField(i, { key: e.target.value })}
              placeholder="key"
              className="rounded ad-border ad-bg-input px-2 py-1 text-sm ad-text"
            />
            <input
              value={field.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              placeholder="Label"
              className="rounded ad-border ad-bg-input px-2 py-1 text-sm ad-text"
            />
            <select
              value={field.type === "repo" ? `repo:${field.repoAccess || "invite_required"}` : field.type}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith("repo:")) {
                  const access = val.split(":")[1] as "public" | "invite_required" | "any";
                  updateField(i, { type: "repo", repoAccess: access });
                } else {
                  updateField(i, { type: val as SubmissionFieldConfig["type"], repoAccess: undefined });
                }
              }}
              className="rounded ad-border ad-bg-input px-2 py-1 text-sm ad-text"
            >
              <option value="url">URL</option>
              <option value="file">File Upload</option>
              <option value="text">Text</option>
              <option value="repo:any">Repo (public or private)</option>
              <option value="repo:public">Repo (must be public)</option>
              <option value="repo:invite_required">Repo (must be private)</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs ad-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(i, { required: e.target.checked })}
                  className="h-4 w-4 rounded accent-purple-700"
                />
                Required
              </label>
              {field.type === "file" && (
                <input
                  value={field.accept || ""}
                  onChange={(e) => updateField(i, { accept: e.target.value })}
                  placeholder=".pdf,.pptx"
                  className="rounded ad-border ad-bg-input px-2 py-1 text-xs ad-text-muted w-32"
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => removeField(i)}
              className="text-xs ad-text-error hover:underline"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminChallengesPage({ params }: { params: Promise<{ id: string }> }) {
  const [chapterId, setChapterId] = useState("");
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorLogoUrl, setSponsorLogoUrl] = useState("");
  const [prizeDescription, setPrizeDescription] = useState("");
  const [judgingCriteria, setJudgingCriteria] = useState("");
  const [codeReviewEnabled, setCodeReviewEnabled] = useState(true);
  const [isScored, setIsScored] = useState(true);
  const [inviteJuryToForks, setInviteJuryToForks] = useState(false);
  const [entireRequired, setEntireRequired] = useState(false);
  const [submissionFields, setSubmissionFields] = useState<SubmissionFieldConfig[]>(DEFAULT_FIELDS);
  const [codeReviewInstructions, setCodeReviewInstructions] = useState("");
  const [briefFileId, setBriefFileId] = useState<string | null>(null);
  const [briefUploading, setBriefUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    params.then(async ({ id }) => {
      setChapterId(id);
      const res = await fetch(`/api/admin/chapters/${id}/challenges`);
      const data = await res.json();
      setChallenges(data);
      setLoading(false);
    });
  }, [params]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setSponsorName("");
    setSponsorLogoUrl("");
    setPrizeDescription("");
    setJudgingCriteria("");
    setCodeReviewEnabled(true);
    setCodeReviewInstructions("");
    setIsScored(true);
    setInviteJuryToForks(false);
    setEntireRequired(false);
    setSubmissionFields(DEFAULT_FIELDS);
    setBriefFileId(null);
    setLogoPreview(null);
    setEditingId(null);
    setError(null);
  }

  function startEdit(challenge: Challenge) {
    setTitle(challenge.title);
    setDescription(challenge.description || "");
    setSponsorName(challenge.sponsorName || "");
    setSponsorLogoUrl(challenge.sponsorLogoUrl || "");
    setLogoPreview(challenge.sponsorLogoUrl || null);
    setPrizeDescription(challenge.prizeDescription || "");
    setJudgingCriteria(challenge.judgingCriteria || "");
    setCodeReviewEnabled(challenge.codeReviewEnabled);
    setCodeReviewInstructions(challenge.codeReviewInstructions || "");
    setIsScored(challenge.isScored);
    setInviteJuryToForks(challenge.inviteJuryToForks);
    setEntireRequired(challenge.entireRequired);
    setSubmissionFields(challenge.submissionFields);
    setBriefFileId(challenge.briefFileId);
    setEditingId(challenge.id);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const formData = new FormData();
    formData.set("chapterId", chapterId);
    formData.set("title", title);
    formData.set("description", description);
    formData.set("sponsorName", sponsorName);
    formData.set("sponsorLogoUrl", sponsorLogoUrl);
    formData.set("prizeDescription", prizeDescription);
    formData.set("judgingCriteria", judgingCriteria);
    if (codeReviewEnabled) formData.set("codeReviewEnabled", "on");
    if (codeReviewInstructions.trim()) formData.set("codeReviewInstructions", codeReviewInstructions.trim());
    if (isScored) formData.set("isScored", "on");
    if (inviteJuryToForks) formData.set("inviteJuryToForks", "on");
    if (entireRequired) formData.set("entireRequired", "on");
    formData.set("submissionFields", JSON.stringify(submissionFields));
    if (briefFileId) formData.set("briefFileId", briefFileId);

    let result;
    if (editingId) {
      formData.set("challengeId", editingId);
      result = await updateChallenge(formData);
    } else {
      result = await createChallenge(formData);
    }

    if (result?.error) {
      setError(result.error);
    } else {
      // Refresh challenges
      const res = await fetch(`/api/admin/chapters/${chapterId}/challenges`);
      setChallenges(await res.json());
      setShowForm(false);
      resetForm();
    }
    setSaving(false);
  }

  async function handleDelete(challengeId: string) {
    if (!confirm("Are you sure you want to delete this challenge?")) return;
    setSaving(true);
    const result = await deleteChallenge(challengeId, chapterId);
    if (!result.error) {
      setChallenges((prev) => prev.filter((c) => c.id !== challengeId));
    }
    setSaving(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setError(null);

    const uploadData = new FormData();
    uploadData.set("file", file);
    uploadData.set("bucket", "sponsor-logos");

    try {
      const result = await adminUpload(uploadData);
      if (result.error) {
        setError(result.error);
      } else if (result.url) {
        setSponsorLogoUrl(result.url);
        setLogoPreview(URL.createObjectURL(file));
      }
    } catch {
      setError("Logo upload failed");
    }
    setLogoUploading(false);
  }

  async function handleBriefUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBriefUploading(true);
    setError(null);

    const uploadData = new FormData();
    uploadData.set("file", file);
    uploadData.set("folder", "Challenge Briefs");

    try {
      const result = await adminUpload(uploadData);
      if (result.error) {
        setError(result.error);
      } else if (result.fileId) {
        setBriefFileId(result.fileId);
      }
    } catch {
      setError("Upload failed");
    }
    setBriefUploading(false);
  }

  if (loading) {
    return <div><p className="ad-text-muted">Loading challenges...</p></div>;
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:text-text-secondary transition-colors"
        >
          &larr; Back to Chapter
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Challenges</h1>
          <p className="mt-1 ad-text-secondary">{challenges.length} challenges configured</p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowForm(!showForm);
          }}
        >
          {showForm ? "Cancel" : "+ New Challenge"}
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="mt-6">
          <h2 className="ad-heading text-lg">
            {editingId ? "Edit Challenge" : "New Challenge"}
          </h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm ad-text-muted">Title *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Challenge title"
                className="mt-1 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm ad-text-muted">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What teams should build..."
                className="mt-1 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm ad-text-muted">Sponsor Name</label>
                <input
                  value={sponsorName}
                  onChange={(e) => setSponsorName(e.target.value)}
                  placeholder="e.g. HappyRobot"
                  className="mt-1 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm ad-text-muted">Sponsor Logo</label>
                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                    className="rounded-lg border border-dashed ad-border px-4 py-2.5 text-sm ad-text-muted transition-colors hover:text-text-secondary"
                  >
                    {logoUploading ? "Uploading..." : logoPreview ? "Change" : "Upload logo"}
                  </button>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*,.svg"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  {logoPreview && (
                    <div className="flex h-10 w-20 items-center justify-center rounded-lg ad-bg-elevated p-1.5">
                      <Image
                        src={logoPreview}
                        alt="Logo preview"
                        width={64}
                        height={32}
                        className="h-7 w-auto object-contain"
                      />
                    </div>
                  )}
                  {sponsorLogoUrl && !logoUploading && (
                    <button
                      type="button"
                      onClick={() => { setSponsorLogoUrl(""); setLogoPreview(null); }}
                      className="text-xs ad-text-error hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm ad-text-muted">Prize Description</label>
              <input
                value={prizeDescription}
                onChange={(e) => setPrizeDescription(e.target.value)}
                placeholder="e.g. $1,000 + mentoring"
                className="mt-1 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm ad-text-muted">Judging Criteria</label>
              <textarea
                value={judgingCriteria}
                onChange={(e) => setJudgingCriteria(e.target.value)}
                rows={2}
                placeholder="Innovation, technical implementation, design..."
                className="mt-1 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
              />
            </div>

            {/* Challenge Brief PDF */}
            <div>
              <label className="block text-sm ad-text-muted">Challenge Brief (PDF)</label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleBriefUpload}
                  disabled={briefUploading}
                  className="text-sm ad-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--admin-accent-bg)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--admin-link)] hover:file:bg-[var(--admin-accent-hover)]"
                />
                {briefUploading && <span className="text-xs ad-text-muted">Uploading...</span>}
                {briefFileId && !briefUploading && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs ad-text-success">PDF uploaded</span>
                    <button
                      type="button"
                      onClick={() => setBriefFileId(null)}
                      className="text-xs ad-text-error hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs ad-text-muted">
                Detailed challenge description PDF. Visible to participants during challenge selection.
              </p>
            </div>

            {/* Scored Toggle */}
            <Toggle
              checked={isScored}
              onChange={setIsScored}
              label="Scored Challenge"
              description="Counts for league points. Challenge partner challenges are scored, community challenges are not."
            />

            {/* Code Review Toggle */}
            <Toggle
              checked={codeReviewEnabled}
              onChange={setCodeReviewEnabled}
              label="Automatic Code Review"
              description="Generate LLM-powered code reviews for submissions with GitHub repos"
            />

            {/* Code Review Config (shown when code review is enabled) */}
            {codeReviewEnabled && (
              <div className="ml-4 border-l-2 ad-border-strong pl-4 space-y-3">
                <div>
                  <label className="block text-sm ad-text-muted">Code Review Instructions</label>
                  <textarea
                    value={codeReviewInstructions}
                    onChange={(e) => setCodeReviewInstructions(e.target.value)}
                    rows={3}
                    placeholder="Tell the AI reviewer what to focus on..."
                    className="mt-1 w-full rounded-lg ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none"
                  />
                  <p className="mt-1 text-xs ad-text-muted">
                    Additional context for the AI reviewer. Challenge description, judging criteria, and brief PDF are included automatically.
                  </p>
                </div>

                {/* Score weights preview */}
                {(() => {
                  const config = editingId
                    ? challenges.find((c) => c.id === editingId)?.codeReviewConfig
                    : null;
                  const w = config?.weights ?? { code_quality: 30, architecture: 25, challenge_alignment: 25, innovation: 20 };
                  const isDefault = !config?.weights;
                  return (
                    <div className="rounded-lg ad-bg-elevated p-3">
                      <p className="text-xs font-bold uppercase tracking-wider ad-text-muted">
                        Score Weights {isDefault && <span className="font-normal">(defaults)</span>}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="ad-text-secondary">Code Quality <span className="font-mono ad-text-gold">{w.code_quality}%</span></span>
                        <span className="ad-text-secondary">Architecture <span className="font-mono ad-text-gold">{w.architecture}%</span></span>
                        <span className="ad-text-secondary">Challenge Alignment <span className="font-mono ad-text-gold">{w.challenge_alignment}%</span></span>
                        <span className="ad-text-secondary">Innovation <span className="font-mono ad-text-gold">{w.innovation}%</span></span>
                      </div>
                      {editingId && (
                        <Link
                          href={`/admin/chapters/${chapterId}/code-reviews?challenge=${editingId}`}
                          className="mt-2 inline-block text-xs ad-text-link hover:underline"
                        >
                          Configure models &amp; weights &rarr;
                        </Link>
                      )}
                      {!editingId && (
                        <p className="mt-2 text-[10px] ad-text-muted">
                          Save challenge first, then configure models and weights on the Code Reviews page.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Entire Session History Toggle */}
            {submissionFields.some((f) => f.type === "repo") && (
              <Toggle
                checked={entireRequired}
                onChange={setEntireRequired}
                label="Require Entire Session History"
                description="Teams must include an Entire session record (the entire/checkpoints/v1 branch with at least one prompt) to submit. The history is captured into the private fork and scored as an advisory process-quality bonus in the code review (never counts toward placement)."
              />
            )}

            {/* Jury Fork Access Toggle */}
            {submissionFields.some((f) => f.type === "repo") && (
              <Toggle
                checked={inviteJuryToForks}
                onChange={setInviteJuryToForks}
                label="Invite Jury to Forked Repos"
                description="When submissions close, jury members get read access to EHL's forked copies of the repos (via their GitHub email)"
              />
            )}

            {/* Submission Fields */}
            <FieldEditor fields={submissionFields} onChange={setSubmissionFields} />

            {error && <p className="text-sm ad-text-error">{error}</p>}

            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update Challenge" : "Create Challenge"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="text-sm ad-text-muted hover:text-text-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Challenge list */}
      <div className="mt-6 space-y-4">
        {challenges.map((challenge) => (
          <Card key={challenge.id}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="ad-heading text-lg">{challenge.title}</h3>
                {challenge.sponsorName && (
                  <p className="text-sm ad-text-muted">by {challenge.sponsorName}</p>
                )}
                {challenge.description && (
                  <p className="mt-2 text-sm ad-text-secondary line-clamp-2">
                    {challenge.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${challenge.isScored ? "ad-border-warning ad-bg-warning ad-text-warning" : "ad-border-strong ad-bg-accent ad-text-link"}`}>
                    {challenge.isScored ? "Scored" : "Community (unscored)"}
                  </span>
                  <span className="rounded-full border ad-border ad-bg-elevated px-2.5 py-1 text-xs ad-text-muted">
                    {challenge.submissionFields.length} fields
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${challenge.codeReviewEnabled ? "ad-border-warning ad-bg-warning ad-text-warning" : "ad-border ad-bg-elevated ad-text-muted"}`}>
                    {challenge.codeReviewEnabled ? "Code Review ON" : "Code Review OFF"}
                  </span>
                  {challenge.briefFileId && (
                    <span className="rounded-full border ad-border-info ad-bg-info px-2.5 py-1 text-xs ad-text-info">
                      Brief PDF
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(challenge)}
                  className="text-sm ad-text-link transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(challenge.id)}
                  className="text-sm ad-text-error hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          </Card>
        ))}
        {challenges.length === 0 && (
          <Card>
            <p className="text-center ad-text-muted py-8">
              No challenges yet. Create one to get started.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
