"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes";
import { Card } from "@/components/ui/card";
import { LimitBanner } from "@/components/admin/limit-banner";
import {
  updateChapterEmailSettings,
  sendChapterBroadcast,
  getBroadcastRecipientCount,
} from "@/lib/actions/communications";
import {
  BROADCASTABLE_STATUSES,
  DEFAULT_BROADCAST_STATUSES,
} from "@/lib/communications";
import { QUERY_LIMITS } from "@/lib/config/limits";
import { formatDate } from "@/lib/utils";
import type { ApplicationStatus } from "@/lib/types";

interface Props {
  chapterId: string;
  chapterName: string;
  initial: {
    acceptanceSubject: string;
    acceptanceMessage: string;
    eventInfo: string;
  };
  lastBroadcast: { subject: string; recipientCount: number; sentAt: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  accepted: "Accepted",
  checked_in: "Checked in",
  waitlisted: "Waitlisted",
};

const inputClass =
  "mt-1 w-full rounded-lg border ad-border ad-bg-input px-4 py-2.5 ad-text focus:outline-none";
const btnClass =
  "mt-4 rounded-lg bg-gradient-to-r from-gold to-gold-dark px-6 py-3 text-sm font-bold text-surface-deep transition-all hover:shadow-[0_0_20px_rgba(255,204,106,0.2)] disabled:opacity-40 disabled:cursor-not-allowed";

function Status({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      className={`mt-3 rounded-lg px-4 py-2 text-sm ${
        msg.ok ? "ad-bg-success ad-text-success" : "ad-bg-error ad-text-error"
      }`}
    >
      {msg.text}
    </p>
  );
}

export function CommunicationsClient({
  chapterId,
  chapterName,
  initial,
  lastBroadcast,
}: Props) {
  // ─── Acceptance email customization ───
  const [subject, setSubject] = useState(initial.acceptanceSubject);
  const [message, setMessage] = useState(initial.acceptanceMessage);
  const [savingAccept, setSavingAccept] = useState(false);
  const [acceptMsg, setAcceptMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Last-saved baselines for the persistent settings, so the unsaved-changes
  // guard clears after a successful save (props don't refresh without a reload).
  const savedAccept = useRef({
    subject: initial.acceptanceSubject,
    message: initial.acceptanceMessage,
  });

  async function saveAcceptance() {
    setSavingAccept(true);
    setAcceptMsg(null);
    const res = await updateChapterEmailSettings(chapterId, {
      acceptanceSubject: subject,
      acceptanceMessage: message,
    });
    if (res.error) {
      setAcceptMsg({ ok: false, text: res.error });
    } else {
      savedAccept.current = { subject, message };
      setAcceptMsg({ ok: true, text: "Acceptance email settings saved." });
    }
    setSavingAccept(false);
  }

  // ─── Event info ───
  const [eventInfo, setEventInfo] = useState(initial.eventInfo);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const savedEventInfo = useRef(initial.eventInfo);

  async function saveEventInfo() {
    setSavingInfo(true);
    setInfoMsg(null);
    const res = await updateChapterEmailSettings(chapterId, { eventInfo });
    if (res.error) {
      setInfoMsg({ ok: false, text: res.error });
    } else {
      savedEventInfo.current = eventInfo;
      setInfoMsg({ ok: true, text: "Event info saved. Participants see it immediately." });
    }
    setSavingInfo(false);
  }

  // ─── Broadcast composer ───
  const [bcSubject, setBcSubject] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [statuses, setStatuses] = useState<ApplicationStatus[]>(
    DEFAULT_BROADCAST_STATUSES
  );
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [bcMsg, setBcMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Warn before leaving with unsaved acceptance/event-info edits or an unsent,
  // partly-composed broadcast. The broadcast is transient (no draft persistence),
  // so a half-written one is exactly what's easy to lose by navigating away.
  const isDirty =
    subject !== savedAccept.current.subject ||
    message !== savedAccept.current.message ||
    eventInfo !== savedEventInfo.current ||
    bcSubject.trim() !== "" ||
    bcBody.trim() !== "";
  useUnsavedChanges(isDirty);

  const refreshCount = useCallback(async () => {
    if (statuses.length === 0) {
      setRecipientCount(0);
      return;
    }
    const res = await getBroadcastRecipientCount(chapterId, statuses);
    if (!res.error) setRecipientCount(res.count ?? 0);
  }, [chapterId, statuses]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  function toggleStatus(s: ApplicationStatus) {
    setStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function send() {
    if (statuses.length === 0) {
      setBcMsg({ ok: false, text: "Select at least one recipient status." });
      return;
    }
    const n = recipientCount ?? 0;
    if (!confirm(`Send this email to ${n} applicant(s)? This cannot be undone.`)) {
      return;
    }
    setSending(true);
    setBcMsg(null);
    const res = await sendChapterBroadcast(chapterId, bcSubject, bcBody, statuses);
    if (res.error) {
      setBcMsg({ ok: false, text: res.error });
    } else {
      const failTxt = res.failed ? `, ${res.failed} failed` : "";
      const remainTxt = res.remaining
        ? `. ${res.remaining} not reached (time limit): narrow the status filter and send again.`
        : ".";
      setBcMsg({
        ok: true,
        text: `Sent to ${res.sent} applicant(s)${failTxt}${remainTxt}`,
      });
      setBcSubject("");
      setBcBody("");
      refreshCount();
    }
    setSending(false);
  }

  const cap = QUERY_LIMITS.broadcastRecipients;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary"
        >
          &larr; Back to chapter
        </Link>
        <h1 className="mt-2 ad-title text-2xl">Communications</h1>
        <p className="mt-1 ad-text-secondary">{chapterName}</p>
      </div>

      {/* Acceptance email customization */}
      <Card>
        <h2 className="mb-1 ad-heading text-lg">Acceptance email</h2>
        <p className="mb-4 text-sm ad-text-muted">
          The QR code, check-in instructions, match details and button are always
          included. You can customize the subject line and add a message shown near
          the top of the email.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="acceptance-subject" className="block text-sm ad-text-muted">
              Subject
            </label>
            <input
              id="acceptance-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={`You're in! Accepted for ${chapterName}`}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acceptance-message" className="block text-sm ad-text-muted">
              Custom message (optional)
            </label>
            <textarea
              id="acceptance-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="e.g. Join our Discord for last-minute details: https://discord.gg/..."
              className={inputClass}
            />
          </div>
        </div>
        <button onClick={saveAcceptance} disabled={savingAccept} className={btnClass}>
          {savingAccept ? "Saving..." : "Save acceptance email"}
        </button>
        <Status msg={acceptMsg} />
      </Card>

      {/* Event info */}
      <Card>
        <h2 className="mb-1 ad-heading text-lg">Event info</h2>
        <p className="mb-4 text-sm ad-text-muted">
          Shown at the top of the participant event hub. Saved instantly, no email
          is sent. Good for the Discord link, schedule, and venue notes.
        </p>
        <textarea
          aria-label="Event info"
          value={eventInfo}
          onChange={(e) => setEventInfo(e.target.value)}
          rows={6}
          placeholder="Discord: https://discord.gg/...&#10;Doors open 09:00, kickoff 10:00&#10;Venue: ..."
          className={inputClass}
        />
        <button onClick={saveEventInfo} disabled={savingInfo} className={btnClass}>
          {savingInfo ? "Saving..." : "Save event info"}
        </button>
        <Status msg={infoMsg} />
      </Card>

      {/* Broadcast composer */}
      <Card>
        <h2 className="mb-1 ad-heading text-lg">Broadcast email</h2>
        <p className="mb-4 text-sm ad-text-muted">
          Send a one-off branded email to this chapter&apos;s applicants. Rejected
          and cancelled applicants never receive broadcasts.
        </p>
        {lastBroadcast && (
          <p className="mb-4 text-xs ad-text-muted">
            Last sent: &quot;{lastBroadcast.subject}&quot; to{" "}
            {lastBroadcast.recipientCount} on {formatDate(lastBroadcast.sentAt)}.
          </p>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm ad-text-muted">Recipients</label>
            <div className="mt-2 flex flex-wrap gap-4">
              {BROADCASTABLE_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm ad-text">
                  <input
                    type="checkbox"
                    checked={statuses.includes(s)}
                    onChange={() => toggleStatus(s)}
                  />
                  {STATUS_LABELS[s]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs ad-text-muted">
              {recipientCount === null
                ? "Counting recipients..."
                : `${recipientCount} applicant(s) match.`}
            </p>
            {recipientCount !== null && (
              <LimitBanner
                count={recipientCount}
                limit={cap}
                label="recipients per send"
              />
            )}
          </div>
          <div>
            <label htmlFor="broadcast-subject" className="block text-sm ad-text-muted">
              Subject
            </label>
            <input
              id="broadcast-subject"
              type="text"
              value={bcSubject}
              onChange={(e) => setBcSubject(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="broadcast-message" className="block text-sm ad-text-muted">
              Message
            </label>
            <textarea
              id="broadcast-message"
              value={bcBody}
              onChange={(e) => setBcBody(e.target.value)}
              rows={8}
              className={inputClass}
            />
          </div>
        </div>
        <button
          onClick={send}
          disabled={sending || !bcSubject.trim() || !bcBody.trim() || statuses.length === 0}
          className={btnClass}
        >
          {sending ? "Sending..." : "Send broadcast"}
        </button>
        <Status msg={bcMsg} />
      </Card>
    </div>
  );
}
