"use client";

import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { submitProject } from "@/lib/actions/submissions";
import type { SubmissionFieldConfig, Submission } from "@/lib/types";

interface SubmissionFormProps {
  challengeId: string;
  teamId: string;
  submissionFields: SubmissionFieldConfig[];
  existing: Submission | null;
  isLocked: boolean;
  deadline?: string | null;
  // When true, repo fields must carry an Entire session record to submit. We
  // surface this as a live warning during verify; the hard gate is server-side.
  entireRequired?: boolean;
}

export function SubmissionForm({
  challengeId,
  teamId,
  submissionFields,
  existing,
  isLocked: isLockedProp,
  deadline,
  entireRequired = false,
}: SubmissionFormProps) {
  // Also check deadline client-side (cron may not have set is_locked yet)
  const isLocked = isLockedProp || (deadline ? new Date(deadline) <= new Date() : false);
  const [projectName, setProjectName] = useState(existing?.projectName || "");
  const [shortDescription, setShortDescription] = useState(
    existing?.shortDescription || ""
  );
  const [fields, setFields] = useState<Record<string, string>>(
    existing?.fields || {}
  );
  const [techStackInput, setTechStackInput] = useState(
    (existing?.techStack || []).join(", ")
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [repoStatus, setRepoStatus] = useState<
    Record<
      string,
      {
        checking: boolean;
        valid?: boolean;
        error?: string;
        warning?: string;
        repoName?: string;
        // Live, non-blocking Entire session-history feedback (the hard gate runs
        // server-side at submit). Present only when the challenge requires Entire.
        entireWarning?: string;
        entireOk?: boolean;
      }
    >
  >({});

  function updateField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleFileUpload(key: string, file: File) {
    setUploading((prev) => ({ ...prev, [key]: true }));
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("teamId", teamId);
    formData.set("challengeId", challengeId);

    try {
      const res = await fetch("/api/submissions/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed");
      } else {
        updateField(key, data.url);
        setFileNames((prev) => ({ ...prev, [key]: data.fileName || file.name }));
      }
    } catch (err) {
      console.error("Upload error:", err);
      setError("Upload failed. Please try again.");
    } finally {
      setUploading((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function verifyRepo(key: string, repoUrl: string, accessMode: string) {
    if (!repoUrl.trim()) {
      setRepoStatus((prev) => ({ ...prev, [key]: { checking: false } }));
      return;
    }

    setRepoStatus((prev) => ({ ...prev, [key]: { checking: true } }));

    try {
      const res = await fetch("/api/submissions/verify-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, accessMode, entireRequired }),
      });

      const data = await res.json();

      setRepoStatus((prev) => ({
        ...prev,
        [key]: {
          checking: false,
          valid: data.valid,
          error: data.error,
          warning: data.warning,
          repoName: data.repoName,
          entireWarning: data.entireWarning,
          entireOk: data.entireOk,
        },
      }));
    } catch {
      setRepoStatus((prev) => ({
        ...prev,
        [key]: { checking: false, error: "Could not verify repository." },
      }));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Check repo fields: must be verified before submit
    const repoFields = submissionFields.filter((f) => f.type === "repo");
    for (const rf of repoFields) {
      const url = fields[rf.key];
      if (!url && !rf.required) continue;
      if (!url && rf.required) {
        setError(`"${rf.label}" is required.`);
        return;
      }
      const status = repoStatus[rf.key];
      if (status?.valid === false) {
        setError(`Please fix the repository issue for "${rf.label}" before submitting.`);
        return;
      }
      if (!status?.valid) {
        setError(`Please verify "${rf.label}" before submitting (click the Verify button).`);
        return;
      }
    }

    setSaving(true);

    const techStack = techStackInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const formData = new FormData();
    formData.set("challengeId", challengeId);
    formData.set("teamId", teamId);
    formData.set("projectName", projectName);
    formData.set("shortDescription", shortDescription);
    formData.set("fields", JSON.stringify(fields));
    formData.set("techStack", JSON.stringify(techStack));

    const result = await submitProject(formData);

    if (result?.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
    setSaving(false);
  }

  if (isLocked) {
    return (
      <Card>
        <div className="text-center py-4">
          <p className="text-lg font-bold">Submissions Locked</p>
          <p className="mt-1 text-sm text-text-muted">
            The submission deadline has passed. Your submission can no longer be edited.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="space-y-5">
        <h3 className="text-lg font-bold">
          {existing ? "Edit Submission" : "Submit Project"}
        </h3>

        {/* Fixed fields */}
        <div>
          <label className="block text-sm text-text-muted">
            Project Name <span className="text-error">*</span>
          </label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            required
            placeholder="Your project name"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary focus:border-purple focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm text-text-muted">
            Short Description (max 300 chars)
          </label>
          <textarea
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value.slice(0, 300))}
            rows={3}
            placeholder="What does your project do?"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary focus:border-purple focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-text-muted">
            {shortDescription.length}/300
          </p>
        </div>

        {/* Dynamic fields */}
        {submissionFields.map((fieldConfig) => (
          <div key={fieldConfig.key}>
            <label className="block text-sm text-text-muted">
              {fieldConfig.label}{" "}
              {fieldConfig.required && <span className="text-error">*</span>}
            </label>
            {fieldConfig.type === "text" ? (
              <textarea
                value={fields[fieldConfig.key] || ""}
                onChange={(e) => updateField(fieldConfig.key, e.target.value)}
                required={fieldConfig.required}
                rows={3}
                placeholder={fieldConfig.placeholder}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary focus:border-purple focus:outline-none"
              />
            ) : fieldConfig.type === "url" ? (
              <input
                type="url"
                value={fields[fieldConfig.key] || ""}
                onChange={(e) => updateField(fieldConfig.key, e.target.value)}
                required={fieldConfig.required}
                placeholder={fieldConfig.placeholder || "https://..."}
                className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary focus:border-purple focus:outline-none"
              />
            ) : fieldConfig.type === "repo" ? (
              <div>
                <div className="mt-1 flex gap-2">
                  <input
                    type="url"
                    value={fields[fieldConfig.key] || ""}
                    onChange={(e) => {
                      updateField(fieldConfig.key, e.target.value);
                      // Clear status when typing
                      setRepoStatus((prev) => ({ ...prev, [fieldConfig.key]: { checking: false } }));
                    }}
                    required={fieldConfig.required}
                    placeholder="https://github.com/owner/repo"
                    className={`w-full rounded-lg border bg-surface-deep px-4 py-2.5 text-text-primary focus:outline-none ${
                      repoStatus[fieldConfig.key]?.valid === false
                        ? "border-red-500/50 focus:border-red-500"
                        : repoStatus[fieldConfig.key]?.valid === true
                          ? "border-green-500/50 focus:border-green-500"
                          : "border-white/10 focus:border-purple"
                    }`}
                  />
                  <button
                    type="button"
                    disabled={!fields[fieldConfig.key] || repoStatus[fieldConfig.key]?.checking}
                    onClick={() =>
                      verifyRepo(
                        fieldConfig.key,
                        fields[fieldConfig.key],
                        fieldConfig.repoAccess || "public"
                      )
                    }
                    className="shrink-0 rounded-lg bg-purple/20 px-4 py-2.5 text-sm font-medium text-purple-light transition-colors hover:bg-purple/30 disabled:opacity-50"
                  >
                    {repoStatus[fieldConfig.key]?.checking ? "Checking..." : "Verify"}
                  </button>
                </div>

                {/* Status messages */}
                {repoStatus[fieldConfig.key]?.valid === true && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm text-green-400">
                        {repoStatus[fieldConfig.key].repoName} verified
                      </p>
                      {repoStatus[fieldConfig.key].warning && (
                        <p className="mt-1 text-xs text-amber-400">
                          {repoStatus[fieldConfig.key].warning}
                        </p>
                      )}
                      {entireRequired && repoStatus[fieldConfig.key].entireOk && (
                        <p className="mt-1 text-xs text-green-400">
                          Entire session history detected.
                        </p>
                      )}
                      {entireRequired && repoStatus[fieldConfig.key].entireWarning && (
                        <p className="mt-1 text-xs text-amber-400">
                          {repoStatus[fieldConfig.key].entireWarning}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {repoStatus[fieldConfig.key]?.valid === false && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-sm text-red-400">
                      {repoStatus[fieldConfig.key].error}
                    </p>
                  </div>
                )}

                {/* Instructions based on access mode */}
                <p className="mt-1 text-xs text-text-muted">
                  {fieldConfig.repoAccess === "invite_required"
                    ? "Your repository must be private. Invite \"ehl-gg\" as a collaborator on GitHub so the jury can access it."
                    : fieldConfig.repoAccess === "any"
                      ? "Your repository can be public or private. If private, invite \"ehl-gg\" as a collaborator on GitHub."
                      : "Your repository must be publicly accessible."
                  }
                </p>
              </div>
            ) : (
              <div>
                <input
                  ref={(el) => { fileInputRefs.current[fieldConfig.key] = el; }}
                  type="file"
                  accept={fieldConfig.accept || undefined}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(fieldConfig.key, file);
                  }}
                  className="hidden"
                />

                {fields[fieldConfig.key] ? (
                  <div className="mt-1 flex items-center gap-3 rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5">
                    <svg className="h-5 w-5 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                      {fileNames[fieldConfig.key] || "File uploaded"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        updateField(fieldConfig.key, "");
                        setFileNames((prev) => {
                          const next = { ...prev };
                          delete next[fieldConfig.key];
                          return next;
                        });
                      }}
                      className="text-xs text-text-muted hover:text-text-primary transition-colors"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRefs.current[fieldConfig.key]?.click()}
                      className="text-xs text-purple-light hover:text-purple transition-colors"
                    >
                      Replace
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploading[fieldConfig.key]}
                    onClick={() => fileInputRefs.current[fieldConfig.key]?.click()}
                    className="mt-1 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-surface-deep px-4 py-8 text-sm text-text-muted transition-colors hover:border-purple/40 hover:text-text-secondary"
                  >
                    {uploading[fieldConfig.key] ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        Click to upload {fieldConfig.label.toLowerCase()}
                      </>
                    )}
                  </button>
                )}

                {fieldConfig.accept && !fields[fieldConfig.key] && (
                  <p className="mt-1 text-xs text-text-muted">
                    Accepted formats: {fieldConfig.accept}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Tech stack */}
        <div>
          <label className="block text-sm text-text-muted">
            Tech Stack (comma-separated)
          </label>
          <input
            value={techStackInput}
            onChange={(e) => setTechStackInput(e.target.value)}
            placeholder="e.g. Next.js, Python, OpenAI API"
            className="mt-1 w-full rounded-lg border border-white/10 bg-surface-deep px-4 py-2.5 text-text-primary focus:border-purple focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-error">{error}</p>}
        {success && (
          <p className="text-sm text-success">
            Submission saved successfully! You can edit it until the deadline.
          </p>
        )}

        <Button type="submit" disabled={saving || Object.values(uploading).some(Boolean)}>
          {saving
            ? "Saving..."
            : existing
              ? "Update Submission"
              : "Submit Project"}
        </Button>
      </Card>
    </form>
  );
}
