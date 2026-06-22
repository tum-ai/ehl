"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  updateApplicationStatus,
  sendAcceptanceEmails,
  cancelApplication,
  uncancelApplication,
  addApplicationNote,
} from "@/lib/actions/applications";
import type {
  Application,
  ApplicationNote,
  ApplicationStatus,
  ApplicationFormData,
} from "@/lib/types";

type ApplicationDetail = Application & { notes: ApplicationNote[] };

export default function AdminApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string; applicationId: string }>;
}) {
  const [chapterId, setChapterId] = useState("");
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Cancel modal state
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelEmail, setCancelEmail] = useState(false);

  // Notes
  const [newNote, setNewNote] = useState("");

  async function reload(id: string, applicationId: string) {
    const data = await fetch(
      `/api/admin/chapters/${id}/applications/${applicationId}`
    ).then((r) => r.json());
    setApp(data);
  }

  useEffect(() => {
    params.then(async ({ id, applicationId }) => {
      setChapterId(id);
      await reload(id, applicationId);
      setLoading(false);
    });
  }, [params]);

  async function handleStatusChange(status: ApplicationStatus) {
    if (!app) return;
    setActing(true);
    setMessage(null);

    const result = await updateApplicationStatus(app.id, status);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setApp({ ...app, status });
      setMessage({ type: "success", text: `Status updated to "${status}".` });
    }
    setActing(false);
  }

  async function handleSendEmail() {
    if (!app || app.status !== "accepted") return;
    if (!confirm("Send acceptance email with QR code to this applicant?"))
      return;

    setActing(true);
    setMessage(null);
    const result = await sendAcceptanceEmails([app.id]);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Acceptance email sent." });
    }
    setActing(false);
  }

  async function handleCancel() {
    if (!app) return;
    setActing(true);
    setMessage(null);
    const result = await cancelApplication(app.id, cancelReason, cancelEmail);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setShowCancel(false);
      setCancelReason("");
      setCancelEmail(false);
      await reload(chapterId, app.id);
      setMessage({
        type: "success",
        text: cancelEmail
          ? "Applicant cancelled. Confirmation email queued."
          : "Applicant cancelled.",
      });
    }
    setActing(false);
  }

  async function handleUncancel() {
    if (!app) return;
    if (!confirm("Reverse this cancellation and restore the applicant to accepted?"))
      return;
    setActing(true);
    setMessage(null);
    const result = await uncancelApplication(app.id);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      await reload(chapterId, app.id);
      setMessage({ type: "success", text: "Cancellation reversed." });
    }
    setActing(false);
  }

  async function handleAddNote() {
    if (!app || !newNote.trim()) return;
    setActing(true);
    setMessage(null);
    const result = await addApplicationNote(app.id, newNote);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setNewNote("");
      await reload(chapterId, app.id);
    }
    setActing(false);
  }

  if (loading) {
    return (
      <div>
        <p className="ad-text-muted">Loading...</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div>
        <p className="ad-text-error">Application not found.</p>
      </div>
    );
  }

  const fd = app.formData as ApplicationFormData;
  const isCancelled = app.status === "cancelled";

  const statusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return <Badge variant="completed" light>Accepted</Badge>;
      case "rejected":
        return <Badge variant="default" light>Rejected</Badge>;
      case "waitlisted":
        return <Badge variant="announced" light>Waitlisted</Badge>;
      case "checked_in":
        return <Badge variant="live" light>Checked In</Badge>;
      case "cancelled":
        return <Badge variant="default" light>Cancelled</Badge>;
      default:
        return <Badge variant="upcoming" light>Pending</Badge>;
    }
  };

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}/applications`}
          className="text-sm ad-text-link transition-colors"
        >
          &larr; Back to Applications
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="ad-title text-2xl">
            {app.firstName} {app.lastName}
          </h1>
          <p className="mt-1 ad-text-secondary">{app.email}</p>
        </div>
        {statusBadge(app.status)}
      </div>

      {/* Status actions */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium ad-text-muted">
            Change status:
          </span>
          {(
            ["pending", "accepted", "rejected", "waitlisted"] as const
          ).map((status) => (
            <Button
              key={status}
              size="sm"
              variant={app.status === status ? "primary" : "secondary"}
              onClick={() => handleStatusChange(status)}
              disabled={acting || app.status === status || isCancelled}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
          {app.status === "accepted" && (
            <Button size="sm" onClick={handleSendEmail} disabled={acting}>
              Send Acceptance Email
            </Button>
          )}
          {(app.status === "accepted" || app.status === "checked_in") && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowCancel(true)}
              disabled={acting}
            >
              Cancel Applicant
            </Button>
          )}
          {isCancelled && (
            <Button size="sm" onClick={handleUncancel} disabled={acting}>
              Reverse Cancellation
            </Button>
          )}
        </div>

        {isCancelled && (
          <div className="mt-4 rounded-lg ad-bg-error ad-text-error px-4 py-3 text-sm">
            <p className="font-medium">This applicant has been cancelled.</p>
            {app.cancelReason && (
              <p className="mt-1">Reason: {app.cancelReason}</p>
            )}
            {app.cancelledAt && (
              <p className="mt-1 opacity-80">
                Cancelled on {new Date(app.cancelledAt).toLocaleString("de-DE")}
              </p>
            )}
          </div>
        )}
      </Card>

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

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <h2 className="mb-2 ad-heading text-lg">Cancel Applicant</h2>
            <p className="mb-4 text-sm ad-text-muted">
              This keeps the record but marks {app.firstName} as cancelled. A reason
              is required and stored in the notes history.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason (e.g. emailed that they cannot attend)"
              rows={3}
              className="w-full rounded-lg border ad-border ad-bg-input px-3 py-2 text-sm"
            />
            <label className="mt-3 flex items-center gap-2 text-sm ad-text">
              <input
                type="checkbox"
                checked={cancelEmail}
                onChange={(e) => setCancelEmail(e.target.checked)}
              />
              Send cancellation confirmation email to applicant
            </label>
            <div className="mt-4 flex justify-end gap-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setShowCancel(false);
                  setCancelReason("");
                  setCancelEmail(false);
                }}
                disabled={acting}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleCancel}
                disabled={acting || !cancelReason.trim()}
              >
                Confirm Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Personal info */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Personal Information</h2>
          <div className="space-y-3">
            <InfoField label="Name" value={`${app.firstName} ${app.lastName}`} />
            <InfoField label="Email" value={app.email} />
            <InfoField label="Date of Birth" value={fd.dateOfBirth || "Not provided"} />
            <InfoField label="Gender" value={fd.gender || "Not provided"} />
            <InfoField label="Nationality" value={fd.nationality || "Not provided"} />
            <InfoField label="Location" value={fd.city && fd.country ? `${fd.city}, ${fd.country}` : "Not provided"} />
          </div>
        </Card>

        {/* Academic */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Academic Background</h2>
          <div className="space-y-3">
            <InfoField
              label="Currently Studying"
              value={fd.currentlyStudying ? "Yes" : "No"}
            />
            {fd.currentlyStudying && (
              <>
                <InfoField label="University" value={fd.university || "Not provided"} />
                <InfoField label="Degree" value={fd.degree || "Not provided"} />
                <InfoField label="Field of Study" value={fd.fieldOfStudy || "Not provided"} />
                <InfoField label="Graduation Date" value={fd.graduationDate || "Not provided"} />
              </>
            )}
          </div>
        </Card>

        {/* Skills */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Skills and Experience</h2>
          <div className="space-y-3">
            <InfoField
              label="Programming Skills"
              value={fd.hasProgrammingSkills ? "Yes" : "No"}
            />
            <InfoField
              label="TUM.ai Member"
              value={fd.isTumaiMember ? "Yes" : "No"}
            />
            <InfoField
              label="Hackathon Experience"
              value={fd.hackathonExperience || "None"}
            />
            <InfoField label="LinkedIn" value={fd.linkedIn || "Not provided"} link={fd.linkedIn || undefined} />
            <InfoField label="GitHub" value={fd.github || "Not provided"} link={fd.github || undefined} />
            <InfoField label="Website" value={fd.website || "Not provided"} link={fd.website || undefined} />
          </div>
        </Card>

        {/* Team */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Team</h2>
          <div className="space-y-3">
            <InfoField label="Has Team" value={fd.hasTeam ? "Yes" : "No"} />
            {app.existingTeamId && (
              <InfoField label="Existing Team ID" value={app.existingTeamId} />
            )}
            {app.teamMembers.length > 0 && (
              <div>
                <p className="text-sm ad-text-muted mb-2">Team Members:</p>
                <div className="space-y-2">
                  {app.teamMembers.map((member, i) => (
                    <div
                      key={i}
                      className="rounded-lg border ad-border ad-bg-input px-3 py-2 text-sm"
                    >
                      {member.firstName} {member.lastName} ({member.email})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Logistics */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Logistics</h2>
          <div className="space-y-3">
            <InfoField
              label="Dietary Restrictions"
              value={
                fd.dietaryRestrictions === "Other"
                  ? `Other: ${fd.dietaryRestrictionsOther || ""}`
                  : fd.dietaryRestrictions || "None"
              }
            />
            <InfoField label="T-Shirt Cut" value={fd.tshirtCut || "Not provided"} />
            <InfoField label="T-Shirt Size" value={fd.tshirtSize || "Not provided"} />
          </div>
        </Card>

        {/* Discovery and notes */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Other</h2>
          <div className="space-y-3">
            <InfoField
              label="Discovery Source"
              value={
                fd.discoverySource?.length > 0
                  ? fd.discoverySource.join(", ") +
                    (fd.discoverySourceOther
                      ? ` (Other: ${fd.discoverySourceOther})`
                      : "")
                  : "Not provided"
              }
            />
            <InfoField
              label="Additional Notes"
              value={fd.additionalNotes || "None"}
            />
            {app.cvUrl && (
              <div>
                <p className="text-sm ad-text-muted">CV</p>
                <a
                  href={`/api/admin/cv/${app.cvUrl}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm ad-text-link transition-colors"
                >
                  View CV
                </a>
              </div>
            )}
          </div>
        </Card>

        {/* Admin notes history */}
        <Card className="lg:col-span-2">
          <h2 className="mb-4 ad-heading text-lg">Admin Notes</h2>
          {app.notes.length === 0 ? (
            <p className="text-sm ad-text-muted">No notes yet.</p>
          ) : (
            <div className="space-y-3">
              {app.notes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-lg border ad-border ad-bg-input px-3 py-2"
                >
                  <p className="text-sm ad-text whitespace-pre-wrap">{note.body}</p>
                  <p className="mt-1 text-xs ad-text-muted">
                    {note.authorEmail || "Unknown"} on{" "}
                    {new Date(note.createdAt).toLocaleString("de-DE")}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note..."
              rows={2}
              className="flex-1 rounded-lg border ad-border ad-bg-input px-3 py-2 text-sm"
            />
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={acting || !newNote.trim()}
            >
              Add
            </Button>
          </div>
        </Card>

        {/* CV Preview */}
        {app.cvUrl && (
          <Card className="lg:col-span-2">
            <h2 className="mb-4 ad-heading text-lg">CV</h2>
            <div className="rounded-lg border ad-border overflow-hidden" style={{ height: "600px" }}>
              <iframe
                src={`/api/admin/cv/${app.cvUrl}`}
                className="h-full w-full"
                allow="autoplay"
              />
            </div>
          </Card>
        )}

        {/* Consent */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Consent</h2>
          <div className="space-y-3">
            <InfoField
              label="Attendance Commitment"
              value={app.consentAttendance ? "Yes" : "No"}
            />
            <InfoField
              label="Privacy Policy"
              value={app.consentPrivacy ? "Yes" : "No"}
            />
            <InfoField
              label="Newsletter"
              value={app.consentNewsletter ? "Yes" : "No"}
            />
            <InfoField
              label="Recruiting"
              value={app.consentRecruiting ? "Yes" : "No"}
            />
          </div>
        </Card>

        {/* Metadata */}
        <Card>
          <h2 className="mb-4 ad-heading text-lg">Metadata</h2>
          <div className="space-y-3">
            <InfoField
              label="Applied"
              value={new Date(app.createdAt).toLocaleString("de-DE")}
            />
            <InfoField
              label="Last Updated"
              value={new Date(app.updatedAt).toLocaleString("de-DE")}
            />
            <InfoField label="Check-in Token" value={app.checkInToken} />
            {app.checkedInAt && (
              <InfoField
                label="Checked In At"
                value={new Date(app.checkedInAt).toLocaleString("de-DE")}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function InfoField({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: string;
}) {
  return (
    <div>
      <p className="text-sm ad-text-muted">{label}</p>
      {link ? (
        <a
          href={link.startsWith("http") ? link : `https://${link}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm ad-text-link transition-colors break-all"
        >
          {value}
        </a>
      ) : (
        <p className="text-sm ad-text break-all">{value}</p>
      )}
    </div>
  );
}
