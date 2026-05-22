"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createFlag, resolveFlag, getFlags } from "@/lib/actions/flags";
import { adminUpload } from "@/lib/upload";
import type { ParticipantFlag } from "@/lib/types";

interface ParticipantResult {
  email: string;
  firstName: string;
  lastName: string;
  linkedIn: string | null;
  github: string | null;
}

export default function AdminFlagsPage() {
  const [flags, setFlags] = useState<ParticipantFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Participant search for flag creation
  const [participantQuery, setParticipantQuery] = useState("");
  const [participantResults, setParticipantResults] = useState<ParticipantResult[]>([]);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantResult | null>(null);
  const [searchingParticipants, setSearchingParticipants] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function loadData() {
    const result = await getFlags(search || undefined);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setFlags(result.flags);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [search]);

  // Debounced participant search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!participantQuery || participantQuery.length < 2) {
      setParticipantResults([]);
      setShowDropdown(false);
      return;
    }
    setSearchingParticipants(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/participants/search?q=${encodeURIComponent(participantQuery)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setParticipantResults(data);
          setShowDropdown(data.length > 0);
        }
      } catch {
        setParticipantResults([]);
      }
      setSearchingParticipants(false);
    }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [participantQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedParticipant) {
      setMessage({ type: "error", text: "Please select a participant first." });
      return;
    }
    setActing(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);
    if (screenshotUrl) {
      formData.set("screenshotUrl", screenshotUrl);
    }

    const result = await createFlag(formData);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Flag created." });
      formRef.current?.reset();
      setScreenshotUrl(null);
      setSelectedParticipant(null);
      setParticipantQuery("");
      setShowForm(false);
      await loadData();
    }
    setActing(false);
  }

  async function handleResolve(flagId: string) {
    if (!resolveReason.trim()) return;
    setActing(true);
    setMessage(null);

    const result = await resolveFlag(flagId, resolveReason);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Flag resolved." });
      setResolvingId(null);
      setResolveReason("");
      await loadData();
    }
    setActing(false);
  }

  async function handleScreenshotUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("folder", "Flag Screenshots");

      const result = await adminUpload(body);
      if (result.error) {
        setMessage({ type: "error", text: result.error });
      } else if (result.url) {
        setScreenshotUrl(result.url);
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: `Upload failed: ${err instanceof Error ? err.message : "Network error"}`,
      });
    }
    setUploading(false);
  }

  const displayed = flags.filter((f) => {
    if (!showResolved && f.resolvedAt) return false;
    return true;
  });

  if (loading) {
    return (
      <div>
        <p className="ad-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Participant Flags</h1>
          <p className="mt-1 ad-text-secondary">
            Annotate participants with warnings visible during screening.
            Select from known applicants or flag directly from the screening view.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Add Flag"}
        </Button>
      </div>

      {message && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "error"
              ? "ad-bg-error ad-text-error"
              : "ad-bg-success ad-text-success"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Create flag form */}
      {showForm && (
        <Card className="mt-6">
          <h2 className="ad-heading text-lg mb-4">New Flag</h2>
          <form ref={formRef} onSubmit={handleCreate} className="space-y-4">
            {/* Participant search */}
            <div>
              <label className="block text-xs font-medium ad-text-muted mb-1">
                Participant *
              </label>
              {selectedParticipant ? (
                <div className="flex items-center justify-between rounded-lg ad-border ad-bg-elevated px-4 py-2.5">
                  <div className="text-sm">
                    <span className="font-medium ad-text">{selectedParticipant.firstName} {selectedParticipant.lastName}</span>
                    <span className="ad-text-muted ml-2">{selectedParticipant.email}</span>
                    {selectedParticipant.linkedIn && (
                      <span className="ml-2 text-xs ad-text-secondary">LI</span>
                    )}
                    {selectedParticipant.github && (
                      <span className="ml-1 text-xs ad-text-secondary">GH</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedParticipant(null);
                      setParticipantQuery("");
                    }}
                    className="text-xs ad-text-muted hover:ad-text-error transition-colors"
                  >
                    Change
                  </button>
                  {/* Hidden inputs for form submission */}
                  <input type="hidden" name="email" value={selectedParticipant.email} />
                  <input type="hidden" name="firstName" value={selectedParticipant.firstName} />
                  <input type="hidden" name="lastName" value={selectedParticipant.lastName} />
                  {selectedParticipant.linkedIn && (
                    <input type="hidden" name="linkedIn" value={selectedParticipant.linkedIn} />
                  )}
                  {selectedParticipant.github && (
                    <input type="hidden" name="github" value={selectedParticipant.github} />
                  )}
                </div>
              ) : (
                <div className="relative" ref={dropdownRef}>
                  <input
                    type="text"
                    value={participantQuery}
                    onChange={(e) => setParticipantQuery(e.target.value)}
                    onFocus={() => { if (participantResults.length > 0) setShowDropdown(true); }}
                    className="w-full rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
                    placeholder="Search by name or email..."
                  />
                  {searchingParticipants && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs ad-text-muted">Searching...</span>
                  )}
                  {showDropdown && participantResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg ad-border ad-bg-card shadow-lg max-h-60 overflow-y-auto">
                      {participantResults.map((p) => (
                        <button
                          key={p.email}
                          type="button"
                          onClick={() => {
                            setSelectedParticipant(p);
                            setShowDropdown(false);
                            setParticipantQuery("");
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm ad-bg-card-hover transition-colors border-b ad-border last:border-b-0"
                        >
                          <span className="font-medium ad-text">{p.firstName} {p.lastName}</span>
                          <span className="ad-text-muted ml-2">{p.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {showDropdown && participantResults.length === 0 && participantQuery.length >= 2 && !searchingParticipants && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg ad-border ad-bg-card shadow-lg px-4 py-3 text-sm ad-text-muted">
                      No participants found.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium ad-text-muted mb-1">
                Reason / Comment *
              </label>
              <textarea
                name="reason"
                required
                rows={3}
                className="w-full rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none resize-none"
                placeholder="Describe the issue..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium ad-text-muted mb-1">
                Screenshot (optional)
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleScreenshotUpload}
                className="text-sm ad-text-muted"
              />
              {uploading && (
                <p className="text-xs ad-text-muted mt-1">Compressing and uploading...</p>
              )}
              {screenshotUrl && (
                <p className="text-xs ad-text-success mt-1">
                  Screenshot uploaded.{" "}
                  <a
                    href={screenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Preview
                  </a>
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={acting || uploading || !selectedParticipant}>
                Create Flag
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setScreenshotUrl(null);
                  setSelectedParticipant(null);
                  setParticipantQuery("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Filters */}
      <div className="mt-6 flex items-center gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email, name, or reason..."
          className="flex-1 rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm ad-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded"
          />
          Show resolved
        </label>
      </div>

      {/* Flags table */}
      <Card className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b ad-border text-left">
                <th className="pb-3 pr-4 font-medium ad-text-muted">Person</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">
                  Identifiers
                </th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Reason</th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">
                  Created By
                </th>
                <th className="pb-3 pr-4 font-medium ad-text-muted">Date</th>
                <th className="pb-3 font-medium ad-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y ad-border">
              {displayed.map((flag) => (
                <tr
                  key={flag.id}
                  className={flag.resolvedAt ? "opacity-50" : ""}
                >
                  <td className="py-3 pr-4">
                    <p className="font-medium ad-text">{flag.email}</p>
                    {flag.name && (
                      <p className="text-xs ad-text-muted">{flag.name}</p>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex gap-1">
                      {flag.linkedinUsername && (
                        <Badge variant="default" light>
                          LI: {flag.linkedinUsername}
                        </Badge>
                      )}
                      {flag.githubUsername && (
                        <Badge variant="default" light>
                          GH: {flag.githubUsername}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4 max-w-xs">
                    <p className="ad-text truncate" title={flag.reason}>
                      {flag.reason}
                    </p>
                    {flag.screenshotUrl && (
                      <a
                        href={flag.screenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs ad-text-link"
                      >
                        Screenshot
                      </a>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="ad-text-secondary">{flag.createdByName}</p>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <p className="ad-text-muted">
                      {new Date(flag.createdAt).toLocaleDateString("de-DE")}
                    </p>
                  </td>
                  <td className="py-3">
                    {flag.resolvedAt ? (
                      <div>
                        <Badge variant="completed" light>
                          Resolved
                        </Badge>
                        <p className="text-xs ad-text-muted mt-1">
                          {flag.resolvedByName}:{" "}
                          {flag.resolvedReason}
                        </p>
                      </div>
                    ) : resolvingId === flag.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={resolveReason}
                          onChange={(e) => setResolveReason(e.target.value)}
                          placeholder="Reason for resolving..."
                          className="rounded-lg ad-border ad-bg-card px-3 py-1.5 text-xs ad-text placeholder:ad-text-muted focus:outline-none w-48"
                        />
                        <button
                          onClick={() => handleResolve(flag.id)}
                          disabled={acting || !resolveReason.trim()}
                          className="text-xs ad-text-success hover:underline disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => {
                            setResolvingId(null);
                            setResolveReason("");
                          }}
                          className="text-xs ad-text-muted hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setResolvingId(flag.id)}
                        className="text-xs ad-text-success hover:underline"
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {displayed.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center ad-text-muted text-sm"
                  >
                    {flags.length === 0
                      ? "No flags yet."
                      : "No flags match your filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
