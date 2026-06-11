"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  updateApplicationStatus,
  bulkUpdateApplicationStatus,
  sendAcceptanceEmails,
  sendRejectionEmails,
  sendBulkEmails,
  deleteApplication,
} from "@/lib/actions/applications";
import { submitScore, getMyScreenerId } from "@/lib/actions/screening";
import type { Application, ApplicationStatus, ApplicationFormData, FlagMatch } from "@/lib/types";
import { createFlag } from "@/lib/actions/flags";

interface ScreeningScore {
  screenerId: string;
  screenerName: string;
  score: number;
  notes: string | null;
  createdAt: string;
}

interface TumaiVerification {
  selfReported: boolean;
  verified: boolean;
  mismatch: boolean;
  fuzzyMatch?: { matchedName: string; score: number } | null;
}

interface ScreeningInfo {
  isLeagueMember: boolean;
  teamId: string | null;
  teamName: string | null;
  totalPoints: number;
  scores: ScreeningScore[];
  averageScore: number | null;
  previousScores: { chapterName: string; averageScore: number }[];
  pastParticipations: number;
  noShows: number;
  flags: FlagMatch[];
  tumaiVerification?: TumaiVerification;
}

type EnrichedApplication = Application & { screening: ScreeningInfo };

interface Stats {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  waitlisted: number;
  checkedIn: number;
}

export default function AdminApplicationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [chapterId, setChapterId] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [applications, setApplications] = useState<EnrichedApplication[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0, pending: 0, accepted: 0, rejected: 0, waitlisted: 0, checkedIn: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [sortCol, setSortCol] = useState<"name" | "email" | "score" | "league" | "status" | "date">("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Screening panel (old side panel, kept for table click)
  const [activeApp, setActiveApp] = useState<EnrichedApplication | null>(null);
  const [myScreenerId, setMyScreenerId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState<number>(5);
  const [notesInput, setNotesInput] = useState("");
  const [submittingScore, setSubmittingScore] = useState(false);
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);

  // Fullscreen screening mode
  const [screeningMode, setScreeningMode] = useState(false);
  const [screeningIndex, setScreeningIndex] = useState(0);
  const [screeningQueue, setScreeningQueue] = useState<EnrichedApplication[]>([]);

  // Accept top N
  const [showAcceptTop, setShowAcceptTop] = useState(false);
  const [acceptTopN, setAcceptTopN] = useState(20);

  // Inline flag creation
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [creatingFlag, setCreatingFlag] = useState(false);

  const loadData = useCallback(async (id: string) => {
    const [appsRes, statsRes, chapterRes] = await Promise.all([
      fetch(`/api/admin/chapters/${id}/applications?preparation=true`).then((r) => r.json()),
      fetch(`/api/admin/chapters/${id}/applications/stats`).then((r) => r.json()),
      fetch(`/api/admin/chapters/${id}/details`).then((r) => r.json()).catch(() => null),
    ]);
    setApplications(appsRes);
    setStats(statsRes);
    if (chapterRes?.name) setChapterName(chapterRes.name);
  }, []);

  useEffect(() => {
    params.then(async ({ id }) => {
      setChapterId(id);
      const screenerId = await getMyScreenerId();
      setMyScreenerId(screenerId);
      await loadData(id);
      setLoading(false);
    });
  }, [params, loadData]);

  // When opening a panel, check if I already scored this application
  useEffect(() => {
    if (activeApp && myScreenerId) {
      const myScore = activeApp.screening.scores.find((s) => s.screenerId === myScreenerId);
      setHasSubmittedScore(!!myScore);
      if (myScore) {
        setScoreInput(myScore.score);
        setNotesInput(myScore.notes || "");
      } else {
        setScoreInput(5);
        setNotesInput("");
      }
      setShowFlagForm(false);
      setFlagReason("");
    }
  }, [activeApp, myScreenerId]);

  // ─── Filtering + Sorting ────────────────────────────────────

  const filtered = applications.filter((app) => {
    if (statusFilter !== "all" && app.status !== statusFilter) return false;
    if (leagueFilter === "member" && !app.screening?.isLeagueMember) return false;
    if (leagueFilter === "points" && (app.screening?.totalPoints ?? 0) <= 0) return false;
    if (leagueFilter === "new" && app.screening?.isLeagueMember) return false;
    if (leagueFilter === "noshow" && (app.screening?.noShows ?? 0) === 0) return false;
    if (leagueFilter === "tumai_mismatch" && !app.screening?.tumaiVerification?.mismatch && !app.screening?.tumaiVerification?.fuzzyMatch) return false;
    if (leagueFilter === "flagged" && (app.screening?.flags?.length ?? 0) === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        app.firstName.toLowerCase().includes(q) ||
        app.lastName.toLowerCase().includes(q) ||
        app.email.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Dynamic sorting
  const statusOrder: Record<string, number> = { checked_in: 0, accepted: 1, waitlisted: 2, pending: 3, rejected: 4 };

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "name" || col === "email" ? "asc" : "desc");
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let cmp = 0;

    switch (sortCol) {
      case "name":
        cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
        break;
      case "email":
        cmp = a.email.localeCompare(b.email);
        break;
      case "score": {
        const aScore = a.screening?.averageScore ?? -1;
        const bScore = b.screening?.averageScore ?? -1;
        cmp = aScore - bScore;
        break;
      }
      case "league":
        cmp = (a.screening?.totalPoints ?? 0) - (b.screening?.totalPoints ?? 0);
        break;
      case "status":
        cmp = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
        break;
      case "date":
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }

    return cmp * dir;
  });

  const withPointsCount = applications.filter((a) => (a.screening?.totalPoints ?? 0) > 0).length;
  const scoredCount = applications.filter((a) => (a.screening?.scores?.length ?? 0) > 0).length;
  const flaggedCount = applications.filter((a) => (a.screening?.flags?.length ?? 0) > 0).length;

  // ─── Status locking helpers ─────────────────────────────────

  function isStatusLocked(app: Application): boolean {
    return !!(app.acceptanceEmailSentAt || app.rejectionEmailSentAt);
  }

  function canChangeStatus(app: Application, newStatus: ApplicationStatus): boolean {
    // If acceptance or rejection email was already sent, status is locked
    if (app.acceptanceEmailSentAt || app.rejectionEmailSentAt) return false;
    // Waitlisted can be changed to accepted or rejected
    if (app.status === "waitlisted" && (newStatus === "accepted" || newStatus === "rejected")) return true;
    // Pending can be changed to anything
    if (app.status === "pending") return true;
    // Already in this status
    if (app.status === newStatus) return false;
    return false;
  }

  // ─── Fullscreen screening mode ─────────────────────────────

  function startScreening() {
    // Build queue: applications not yet scored by the current screener
    const queue = applications.filter((app) => {
      if (!myScreenerId) return true;
      return !app.screening.scores.some((s) => s.screenerId === myScreenerId);
    });
    if (queue.length === 0) {
      setMessage({ type: "error", text: "No unscored applications left." });
      return;
    }
    setScreeningQueue(queue);
    setScreeningIndex(0);
    setScreeningMode(true);
    setScoreInput(5);
    setNotesInput("");
  }

  const currentScreeningApp = screeningMode ? screeningQueue[screeningIndex] : null;
  const screenedSoFar = screeningIndex;
  const totalInQueue = screeningQueue.length;

  // Check if I already scored the current app (for re-entering screening mode)
  const currentAppMyScore = currentScreeningApp && myScreenerId
    ? currentScreeningApp.screening.scores.find((s) => s.screenerId === myScreenerId)
    : null;

  async function handleScreeningSubmit() {
    if (!currentScreeningApp) return;
    setSubmittingScore(true);
    const result = await submitScore(currentScreeningApp.id, scoreInput, notesInput);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
      setSubmittingScore(false);
      return;
    }

    // Update local state
    const newScores: ScreeningScore[] = (result.scores ?? []).map((s: Record<string, unknown>) => ({
      screenerId: s.screener_id as string,
      screenerName: (s.screener_name as string) ?? "Unknown",
      score: s.score as number,
      notes: (s.notes as string) ?? null,
      createdAt: s.created_at as string,
    }));
    const avg = newScores.length > 0
      ? Math.round((newScores.reduce((sum, s) => sum + s.score, 0) / newScores.length) * 10) / 10
      : null;

    setApplications((prev) =>
      prev.map((app) => {
        if (app.id !== currentScreeningApp.id) return app;
        return { ...app, screening: { ...app.screening, scores: newScores, averageScore: avg } };
      })
    );

    // Also update the queue entry
    setScreeningQueue((prev) =>
      prev.map((app) => {
        if (app.id !== currentScreeningApp.id) return app;
        return { ...app, screening: { ...app.screening, scores: newScores, averageScore: avg } };
      })
    );

    setSubmittingScore(false);

    // Auto-advance to next
    if (screeningIndex < screeningQueue.length - 1) {
      setScreeningIndex((i) => i + 1);
      setScoreInput(5);
      setNotesInput("");
    } else {
      // All done
      setScreeningMode(false);
      setMessage({ type: "success", text: `Screening complete. Scored ${screeningQueue.length} application(s).` });
    }
  }

  function closeScreeningMode() {
    setScreeningMode(false);
    if (chapterId) loadData(chapterId);
  }

  // ─── Selection actions ──────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((a) => a.id)));
    }
  }

  async function handleBulkAction(status: ApplicationStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    // Filter out locked applications
    const actionable = ids.filter((id) => {
      const app = applications.find((a) => a.id === id);
      return app && canChangeStatus(app, status);
    });
    if (actionable.length === 0) {
      setMessage({ type: "error", text: "No actionable applications (some may be locked after email was sent)." });
      return;
    }
    setActing(true);
    setMessage(null);
    const result = await bulkUpdateApplicationStatus(actionable, status);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      const skipped = ids.length - actionable.length;
      const msg = `${actionable.length} application(s) updated to "${status}".` + (skipped > 0 ? ` ${skipped} skipped (locked).` : "");
      setMessage({ type: "success", text: msg });
      setSelected(new Set());
      await loadData(chapterId);
    }
    setActing(false);
  }

  async function handleAcceptTopN() {
    const pending = sorted.filter((a) => a.status === "pending" && a.screening?.averageScore !== null && !isStatusLocked(a));
    const toAccept = pending.slice(0, acceptTopN);
    if (toAccept.length === 0) {
      setMessage({ type: "error", text: "No scored pending applications to accept." });
      return;
    }
    if (!confirm(`Accept the top ${toAccept.length} scored pending applications?`)) return;
    setActing(true);
    setMessage(null);
    const result = await bulkUpdateApplicationStatus(toAccept.map((a) => a.id), "accepted");
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `Accepted ${toAccept.length} application(s).` });
      setSelected(new Set());
      await loadData(chapterId);
    }
    setActing(false);
    setShowAcceptTop(false);
  }

  async function handleSendAcceptanceEmails() {
    const ids = Array.from(selected);
    const accepted = ids.filter((id) => applications.find((a) => a.id === id)?.status === "accepted");
    if (accepted.length === 0) {
      setMessage({ type: "error", text: 'No accepted applications selected.' });
      return;
    }
    if (!confirm(`Send acceptance emails to ${accepted.length} applicant(s)?`)) return;
    setActing(true);
    setMessage(null);
    const result = await sendAcceptanceEmails(accepted);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `Sent ${result.sent} acceptance email(s).` });
      await loadData(chapterId);
    }
    setActing(false);
  }

  async function handleSendRejectionEmails() {
    const ids = Array.from(selected);
    const rejected = ids.filter((id) => applications.find((a) => a.id === id)?.status === "rejected");
    if (rejected.length === 0) {
      setMessage({ type: "error", text: 'No rejected applications selected.' });
      return;
    }
    if (!confirm(`Send rejection emails to ${rejected.length} applicant(s)?`)) return;
    setActing(true);
    setMessage(null);
    const result = await sendRejectionEmails(rejected);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `Sent ${result.sent} rejection email(s).` });
      await loadData(chapterId);
    }
    setActing(false);
  }

  async function handleSendAllPendingEmails() {
    if (!confirm("Send acceptance emails to all accepted + rejection emails to all rejected who haven't been emailed yet?")) return;
    setActing(true);
    setMessage(null);
    try {
      const result = await sendBulkEmails(chapterId);
      if (result.error) {
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({
          type: "success",
          text:
            `Sent ${result.acceptedSent ?? 0} acceptance + ${result.rejectedSent ?? 0} rejection email(s).` +
            (result.remaining ? ` ${result.remaining} still pending — click again to continue.` : ""),
        });
      }
      await loadData(chapterId);
    } catch {
      // A timeout or thrown error must not leave the button stuck. Progress is
      // persisted per-applicant (sent_at), so re-clicking resumes safely.
      setMessage({
        type: "error",
        text: "Sending did not finish (it may have timed out). Already-sent emails are recorded; click again to send the rest.",
      });
      await loadData(chapterId).catch(() => {});
    } finally {
      setActing(false);
    }
  }

  async function handleSingleStatus(id: string, status: ApplicationStatus) {
    const app = applications.find((a) => a.id === id);
    if (app && !canChangeStatus(app, status)) {
      setMessage({ type: "error", text: "Cannot change status after email has been sent." });
      return;
    }
    setActing(true);
    setMessage(null);
    const result = await updateApplicationStatus(id, status);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      await loadData(chapterId);
    }
    setActing(false);
  }

  async function handleDelete(id: string) {
    const app = applications.find((a) => a.id === id);
    if (!app) return;
    if (!confirm(`Delete application from ${app.firstName} ${app.lastName} (${app.email})? This action is logged but cannot be undone.`)) return;
    setActing(true);
    setMessage(null);
    const result = await deleteApplication(id);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `Application from ${app.firstName} ${app.lastName} deleted.` });
      if (activeApp?.id === id) setActiveApp(null);
      await loadData(chapterId);
    }
    setActing(false);
  }

  // ─── Screening score submission (side panel) ───────────────

  async function handleSubmitScore() {
    if (!activeApp) return;
    setSubmittingScore(true);
    const result = await submitScore(activeApp.id, scoreInput, notesInput);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      const newScores: ScreeningScore[] = (result.scores ?? []).map((s: Record<string, unknown>) => ({
        screenerId: s.screener_id as string,
        screenerName: (s.screener_name as string) ?? "Unknown",
        score: s.score as number,
        notes: (s.notes as string) ?? null,
        createdAt: s.created_at as string,
      }));
      const avg = newScores.length > 0
        ? Math.round((newScores.reduce((sum, s) => sum + s.score, 0) / newScores.length) * 10) / 10
        : null;
      setApplications((prev) =>
        prev.map((app) => {
          if (app.id !== activeApp.id) return app;
          return { ...app, screening: { ...app.screening, scores: newScores, averageScore: avg } };
        })
      );
      setHasSubmittedScore(true);
      setActiveApp((prev) => {
        if (!prev) return prev;
        return { ...prev, screening: { ...prev.screening, scores: newScores, averageScore: avg } };
      });
    }
    setSubmittingScore(false);
  }

  // ─── Inline flag creation ───────────────────────────────────

  async function handleCreateFlag(app: EnrichedApplication) {
    if (!flagReason.trim()) return;
    setCreatingFlag(true);
    const formData = new FormData();
    formData.set("email", app.email);
    formData.set("firstName", app.firstName);
    formData.set("lastName", app.lastName);
    if (app.formData?.linkedIn) formData.set("linkedIn", app.formData.linkedIn);
    if (app.formData?.github) formData.set("github", app.formData.github);
    formData.set("reason", flagReason);
    const result = await createFlag(formData);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `Flag created for ${app.firstName} ${app.lastName}.` });
      setShowFlagForm(false);
      setFlagReason("");
      await loadData(chapterId);
    }
    setCreatingFlag(false);
  }

  // ─── Render helpers ─────────────────────────────────────────

  const statusBadge = (status: string) => {
    switch (status) {
      case "accepted": return <Badge variant="completed" light>Accepted</Badge>;
      case "rejected": return <Badge variant="default" light>Rejected</Badge>;
      case "waitlisted": return <Badge variant="announced" light>Waitlisted</Badge>;
      case "checked_in": return <Badge variant="live" light>Checked In</Badge>;
      default: return <Badge variant="upcoming" light>Pending</Badge>;
    }
  };

  if (loading) {
    return <div><p className="ad-text-muted">Loading...</p></div>;
  }

  // ─── Fullscreen screening overlay ──────────────────────────

  if (screeningMode && currentScreeningApp) {
    const app = currentScreeningApp;
    const fd = app.formData as ApplicationFormData;
    const otherScores = app.screening.scores.filter((s) => s.screenerId !== myScreenerId);

    return (
      <div className="fixed inset-0 z-50 flex flex-col ad-bg">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b ad-border px-6 py-3">
          <div className="flex items-center gap-4">
            <span className="rounded-full ad-bg-accent px-3 py-1 text-xs font-bold ad-text-link">
              Screening
            </span>
            <span className="text-sm ad-text-muted">
              {screenedSoFar + 1} / {totalInQueue}
            </span>
            {/* Progress bar */}
            <div className="h-2 w-40 rounded-full ad-bg-elevated overflow-hidden">
              <div
                className="h-full rounded-full bg-purple-500 transition-all duration-300"
                style={{ width: `${totalInQueue > 0 ? ((screenedSoFar + 1) / totalInQueue) * 100 : 0}%` }}
              />
            </div>
          </div>
          <button
            onClick={closeScreeningMode}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ad-text-muted ad-bg-card-hover transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </div>

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Application details */}
          <div className="flex-1 overflow-y-auto p-8">
            <div className="mx-auto max-w-3xl">
              {/* Name + status */}
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="ad-title text-2xl ad-text">
                    {app.firstName} {app.lastName}
                  </h1>
                  <p className="mt-1 ad-text-muted">{app.email}</p>
                </div>
                {statusBadge(app.status)}
              </div>

              {/* Alert cards */}
              <div className="mt-6 flex flex-col gap-3">
                {/* League info */}
                {app.screening?.isLeagueMember && (
                  <div className="rounded-lg border ad-border-warning ad-bg-warning p-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-gold mb-2">League Member</p>
                    <div className="flex flex-wrap gap-6 text-sm ad-text-secondary">
                      <div>Team: <strong className="ad-text-gold">{app.screening.teamName}</strong></div>
                      <div>Points: <strong className="font-mono ad-text-gold">{app.screening.totalPoints}</strong></div>
                      {app.screening.pastParticipations > 0 && (
                        <div>Past events: <strong>{app.screening.pastParticipations}</strong></div>
                      )}
                    </div>
                  </div>
                )}

                {/* TUM.ai fuzzy match warning */}
                {app.screening?.tumaiVerification?.fuzzyMatch && (
                  <div className="rounded-lg border ad-border-warning ad-bg-warning p-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-gold mb-1">TUM.ai Fuzzy Match</p>
                    <p className="text-sm ad-text-secondary">
                      Applicant claims TUM.ai membership. Closest match: <span className="font-semibold">{app.screening.tumaiVerification.fuzzyMatch.matchedName}</span> ({app.screening.tumaiVerification.fuzzyMatch.score}% confidence)
                    </p>
                  </div>
                )}

                {/* TUM.ai mismatch warning */}
                {app.screening?.tumaiVerification?.mismatch && (
                  <div className="rounded-lg border ad-border-error ad-bg-error p-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-error mb-1">TUM.ai Mismatch</p>
                    <p className="text-sm ad-text-error">
                      Applicant claims TUM.ai membership but no match found in member list.
                    </p>
                  </div>
                )}

                {/* TUM.ai verified */}
                {app.screening?.tumaiVerification?.verified && (
                  <div className="rounded-lg border ad-border-success ad-bg-success p-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-success mb-1">TUM.ai Verified</p>
                    <p className="text-sm ad-text-success">
                      TUM.ai membership confirmed via verified member list.
                    </p>
                  </div>
                )}

                {/* Participant flags */}
                {(app.screening?.flags?.length ?? 0) > 0 && app.screening.flags.map((flag) => (
                  <div key={flag.id} className={`rounded-lg border p-4 ${flag.matchedVia === "name" ? "ad-border-warning ad-bg-warning" : "ad-border-error ad-bg-error"}`}>
                    <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${flag.matchedVia === "name" ? "ad-text-gold" : "ad-text-error"}`}>
                      Flagged Participant
                    </p>
                    <p className={`text-sm ${flag.matchedVia === "name" ? "ad-text-gold" : "ad-text-error"}`}>{flag.reason}</p>
                    <p className="text-xs ad-text-muted mt-1">
                      By {flag.createdByName} on {new Date(flag.createdAt).toLocaleDateString("de-DE")} (matched via {flag.matchedVia})
                    </p>
                    {flag.screenshotUrl && (
                      <a href={flag.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-xs ad-text-link mt-1 inline-block">
                        View screenshot
                      </a>
                    )}
                  </div>
                ))}

                {/* No-show warning */}
                {(app.screening?.noShows ?? 0) > 0 && (
                  <div className="rounded-lg border ad-border-error ad-bg-error p-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-error mb-1">No-Show Warning</p>
                    <p className="text-sm ad-text-error">
                      Checked in but did not submit at {app.screening.noShows} previous event(s).
                    </p>
                  </div>
                )}

                {/* Previous screening scores */}
                {app.screening?.previousScores.length > 0 && (
                  <div className="rounded-lg border ad-border-info ad-bg-info p-4">
                    <p className="text-xs font-bold uppercase tracking-wider ad-text-info mb-2">Previous Screening Scores</p>
                    <div className="flex flex-wrap gap-4">
                      {app.screening.previousScores.map((ps) => (
                        <div key={ps.chapterName} className="text-sm">
                          <span className="ad-text-info">{ps.chapterName}:</span>{" "}
                          <span className="font-mono font-bold ad-text-info">{ps.averageScore}/10</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Application details grid */}
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                {/* Personal */}
                <div className="rounded-lg border ad-border p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider ad-text-muted">Personal</h3>
                  <div className="space-y-2 text-sm">
                    <ScreeningDetailRow label="Date of Birth" value={fd.dateOfBirth} />
                    <ScreeningDetailRow label="Gender" value={fd.gender} />
                    <ScreeningDetailRow label="Nationality" value={fd.nationality} />
                    <ScreeningDetailRow label="Location" value={[fd.city, fd.country].filter(Boolean).join(", ")} />
                  </div>
                </div>

                {/* Academic */}
                <div className="rounded-lg border ad-border p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider ad-text-muted">Academic</h3>
                  <div className="space-y-2 text-sm">
                    <ScreeningDetailRow label="University" value={fd.university} />
                    <ScreeningDetailRow label="Degree" value={fd.degree} />
                    <ScreeningDetailRow label="Field" value={fd.fieldOfStudy} />
                    <ScreeningDetailRow label="Graduation" value={fd.graduationDate} />
                  </div>
                </div>

                {/* Skills */}
                <div className="rounded-lg border ad-border p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider ad-text-muted">Skills &amp; Experience</h3>
                  <div className="space-y-2 text-sm">
                    <ScreeningDetailRow label="Programming" value={fd.hasProgrammingSkills ? "Yes" : "No"} />
                    <ScreeningDetailRow label="TUM.ai Member" value={fd.isTumaiMember ? "Yes" : "No"} />
                    {fd.hackathonExperience && (
                      <div>
                        <span className="ad-text-muted">Experience:</span>
                        <p className="mt-1 ad-text-secondary">{fd.hackathonExperience}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Links */}
                <div className="rounded-lg border ad-border p-5">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider ad-text-muted">Links</h3>
                  <div className="space-y-2 text-sm">
                    {fd.linkedIn && (
                      <div>
                        <span className="ad-text-muted">LinkedIn:</span>{" "}
                        <a href={fd.linkedIn.startsWith("http") ? fd.linkedIn : `https://${fd.linkedIn}`} target="_blank" rel="noopener noreferrer" className="ad-text-link transition-colors break-all">
                          {fd.linkedIn}
                        </a>
                      </div>
                    )}
                    {fd.github && (
                      <div>
                        <span className="ad-text-muted">GitHub:</span>{" "}
                        <a href={fd.github.startsWith("http") ? fd.github : `https://${fd.github}`} target="_blank" rel="noopener noreferrer" className="ad-text-link transition-colors break-all">
                          {fd.github}
                        </a>
                      </div>
                    )}
                    {fd.website && (
                      <div>
                        <span className="ad-text-muted">Website:</span>{" "}
                        <a href={fd.website.startsWith("http") ? fd.website : `https://${fd.website}`} target="_blank" rel="noopener noreferrer" className="ad-text-link transition-colors break-all">
                          {fd.website}
                        </a>
                      </div>
                    )}
                    {!fd.linkedIn && !fd.github && !fd.website && (
                      <p className="ad-text-muted">No links provided</p>
                    )}
                  </div>
                </div>
              </div>

              {/* CV inline preview */}
              {app.cvUrl && (
                <div className="mt-6">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider ad-text-muted">CV</h3>
                  <div className="rounded-lg border ad-border overflow-hidden" style={{ height: "600px" }}>
                    <iframe
                      src={`/api/admin/cv/${app.cvUrl}`}
                      className="h-full w-full"
                      allow="autoplay"
                    />
                  </div>
                </div>
              )}

              {/* Additional notes */}
              {fd.additionalNotes && (
                <div className="mt-6 rounded-lg border ad-border p-5">
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider ad-text-muted">Additional Notes</h3>
                  <p className="text-sm ad-text-secondary">{fd.additionalNotes}</p>
                </div>
              )}

              {/* Team info */}
              {fd.hasTeam && app.teamMembers.length > 0 && (
                <div className="mt-6 rounded-lg border ad-border p-5">
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider ad-text-muted">Team Members</h3>
                  <div className="flex flex-wrap gap-2">
                    {app.teamMembers.map((member, i) => (
                      <span key={i} className="rounded-lg border ad-border ad-bg-elevated px-3 py-1.5 text-sm ad-text-secondary">
                        {member.firstName} {member.lastName} ({member.email})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Score panel */}
          <div className="w-[360px] shrink-0 border-l ad-border ad-bg-elevated p-6 flex flex-col">
            <h3 className="ad-heading text-lg ad-text mb-6">Score</h3>

            {/* Other screener's score (blind until submitted) */}
            {otherScores.length > 0 && (
              <div className="mb-6 space-y-2">
                {otherScores.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border ad-border ad-bg-card px-4 py-2.5 text-sm">
                    <span className="ad-text-muted">{currentAppMyScore ? s.screenerName : "Other screener"}</span>
                    {currentAppMyScore ? (
                      <span className={`font-mono font-bold ${
                        s.score >= 7 ? "ad-text-success" : s.score >= 4 ? "ad-text-gold" : "ad-text-error"
                      }`}>
                        {s.score}/10
                      </span>
                    ) : (
                      <span className="text-xs ad-text-muted">Hidden until you score</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Score input */}
            <div className="flex-1">
              <label className="block text-sm font-medium ad-text-secondary mb-2">Your Score (1-10)</label>
              <div className="flex items-center gap-4 mb-4">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={scoreInput}
                  onChange={(e) => setScoreInput(parseInt(e.target.value))}
                  className="flex-1 accent-purple-700"
                />
                <span className="w-12 text-center font-mono text-2xl font-bold ad-text">{scoreInput}</span>
              </div>

              <label className="block text-sm font-medium ad-text-secondary mb-2">Notes (optional)</label>
              <textarea
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                rows={3}
                placeholder="Quick notes..."
                className="w-full rounded-lg border ad-border ad-bg-card px-3 py-2 text-sm ad-text placeholder:ad-text-muted focus:outline-none resize-none"
              />
            </div>

            {/* Submit + nav */}
            <div className="mt-6 space-y-3">
              <Button
                onClick={handleScreeningSubmit}
                disabled={submittingScore}
                className="w-full"
              >
                {submittingScore
                  ? "Saving..."
                  : currentAppMyScore
                    ? "Update Score & Next"
                    : screeningIndex < screeningQueue.length - 1
                      ? "Submit & Next"
                      : "Submit & Finish"
                }
              </Button>

              {/* Skip button */}
              {screeningIndex < screeningQueue.length - 1 && (
                <button
                  onClick={() => {
                    setScreeningIndex((i) => i + 1);
                    setScoreInput(5);
                    setNotesInput("");
                  }}
                  className="w-full rounded-lg border ad-border ad-bg-card px-4 py-2.5 text-sm ad-text-muted ad-bg-card-hover transition-colors"
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main table view ───────────────────────────────────────

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className={`flex-1 min-w-0 ${activeApp ? "lg:mr-[420px]" : ""}`}>
        <div className="mb-8">
          <Link
            href={`/admin/chapters/${chapterId}`}
            className="text-sm ad-text-link transition-colors"
          >
            &larr; Back to Chapter
          </Link>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="ad-title text-2xl">
              Applications{chapterName ? `: ${chapterName}` : ""}
            </h1>
            <p className="mt-1 ad-text-secondary">
              Score applicants, review profiles, and manage acceptances.
            </p>
          </div>

          {/* Start Screening button */}
          <Button onClick={startScreening}>
            Start Screening
          </Button>
        </div>

        {/* Stats bar */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total", value: stats.total, color: "ad-text" },
            { label: "Pending", value: stats.pending, color: "ad-text-warning" },
            { label: "Accepted", value: stats.accepted, color: "ad-text-success" },
            { label: "Rejected", value: stats.rejected, color: "ad-text-error" },
          ].map((stat) => (
            <Card key={stat.label} className="text-center">
              <p className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
              <p className="mt-1 text-xs ad-text-muted">{stat.label}</p>
            </Card>
          ))}
        </div>
        {(stats.waitlisted > 0 || scoredCount > 0 || withPointsCount > 0 || flaggedCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs ad-text-secondary">
            {stats.waitlisted > 0 && (
              <span><span className="font-mono font-bold ad-text-warning">{stats.waitlisted}</span> waitlisted</span>
            )}
            {scoredCount > 0 && (
              <span><span className="font-mono font-bold ad-text">{scoredCount}</span> scored</span>
            )}
            {withPointsCount > 0 && (
              <span><span className="font-mono font-bold ad-text-gold">{withPointsCount}</span> with points</span>
            )}
            {flaggedCount > 0 && (
              <span><span className="font-mono font-bold ad-text-error">{flaggedCount}</span> flagged</span>
            )}
          </div>
        )}

        {/* Search + filters */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border ad-border ad-bg-card px-4 py-2.5 text-sm ad-text focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="waitlisted">Waitlisted</option>
            <option value="checked_in">Checked In</option>
          </select>
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="rounded-lg border ad-border ad-bg-card px-4 py-2.5 text-sm ad-text focus:outline-none"
          >
            <option value="all">All applicants</option>
            <option value="member">League Members</option>
            <option value="points">With Points (&gt;0)</option>
            <option value="new">New applicants</option>
            <option value="noshow">Has No-Shows</option>
            <option value="flagged">Flagged</option>
            <option value="tumai_mismatch">TUM.ai Unverified</option>
          </select>
        </div>

        {/* Bulk actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border ad-border-strong ad-bg-accent px-4 py-3">
              <span className="text-sm font-medium">{selected.size} selected:</span>
              <Button size="sm" onClick={() => handleBulkAction("accepted")} disabled={acting} className="ad-bg-success ad-text-success hover:bg-green-100">Accept</Button>
              <Button size="sm" variant="secondary" onClick={() => handleBulkAction("rejected")} disabled={acting}>Reject</Button>
              <Button size="sm" variant="secondary" onClick={() => handleBulkAction("waitlisted")} disabled={acting}>Waitlist</Button>
              <Button size="sm" onClick={handleSendAcceptanceEmails} disabled={acting}>Send Acceptance Emails</Button>
              <Button size="sm" variant="secondary" onClick={handleSendRejectionEmails} disabled={acting}>Send Rejection Emails</Button>
            </div>
          )}

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Button size="sm" variant="secondary" onClick={() => setShowAcceptTop(!showAcceptTop)} disabled={acting}>
                Accept Top N
              </Button>
              {showAcceptTop && (
                <div className="absolute top-full left-0 z-10 mt-1 rounded-lg border ad-border ad-bg-card p-3 shadow-lg">
                  <label className="block text-xs ad-text-muted mb-1">How many?</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={sorted.length}
                      value={acceptTopN}
                      onChange={(e) => setAcceptTopN(parseInt(e.target.value) || 1)}
                      className="w-20 rounded border ad-border px-2 py-1 text-sm ad-text"
                    />
                    <Button size="sm" onClick={handleAcceptTopN} disabled={acting}>Go</Button>
                  </div>
                </div>
              )}
            </div>
            <Button size="sm" variant="secondary" onClick={handleSendAllPendingEmails} disabled={acting}>
              Send All Pending Emails
            </Button>
          </div>
        </div>

        {/* Messages */}
        {message && (
          <p className={`mt-4 rounded-lg px-4 py-3 text-sm ${message.type === "error" ? "ad-bg-error ad-text-error" : "ad-bg-success ad-text-success"}`}>
            {message.text}
          </p>
        )}

        {/* Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b ad-border text-left text-sm ad-text-muted">
                <th className="pb-3 pr-3 font-medium">
                  <input
                    type="checkbox"
                    checked={sorted.length > 0 && selected.size === sorted.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded accent-purple-700"
                  />
                </th>
                <SortHeader col="name" label="Name" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader col="email" label="Email" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader col="score" label="Score" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader col="league" label="League" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                <th className="pb-3 pr-4 font-medium">Flags</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((app) => {
                const scoreCount = app.screening?.scores?.length ?? 0;
                const avgScore = app.screening?.averageScore;
                const locked = isStatusLocked(app);
                const singleScreener = scoreCount === 1;

                return (
                  <tr
                    key={app.id}
                    onClick={() => setActiveApp(app)}
                    className={`border-b ad-border transition-colors cursor-pointer ${
                      activeApp?.id === app.id
                        ? "ad-bg-accent"
                        : (app.screening?.totalPoints ?? 0) > 0
                          ? "ad-bg-warning ad-bg-card-hover"
                          : app.screening?.isLeagueMember
                            ? "ad-bg-accent ad-bg-card-hover"
                            : "ad-bg-card-hover"
                    }`}
                  >
                    <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(app.id)}
                        onChange={() => toggleSelect(app.id)}
                        className="h-4 w-4 rounded accent-purple-700"
                      />
                    </td>
                    <td className="py-3 pr-4 text-sm font-medium ad-text">
                      {app.firstName} {app.lastName}
                    </td>
                    <td className="py-3 pr-4 text-sm ad-text-secondary">{app.email}</td>
                    <td className="py-3 pr-4">
                      {avgScore !== null ? (
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono text-sm font-bold ${
                            avgScore >= 7 ? "ad-text-success" : avgScore >= 4 ? "ad-text-gold" : "ad-text-error"
                          }`}>
                            {avgScore}
                          </span>
                          <span className="text-[10px] ad-text-muted">({scoreCount}x)</span>
                          {singleScreener && (
                            <span className="inline-flex items-center rounded-full ad-bg-warning px-1.5 py-0.5 text-[10px] font-bold ad-text-gold" title="Only scored by one screener">
                              !
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs ad-text-muted">Unscored</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {app.screening?.isLeagueMember ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full border ad-border-warning ad-bg-warning px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ad-text-gold">
                            Member
                          </span>
                          {(app.screening.totalPoints ?? 0) > 0 && (
                            <span className="font-mono text-xs font-bold ad-text-gold">
                              {app.screening.totalPoints}pts
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs ad-text-muted">New</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1.5">
                        {statusBadge(app.status)}
                        {locked && (
                          <span title="Status locked (email sent)">
                            <svg className="h-3.5 w-3.5 ad-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1">
                        {(app.screening?.flags?.length ?? 0) > 0 && (
                          <span className="inline-flex items-center rounded-full ad-bg-error px-2 py-0.5 text-[10px] font-bold ad-text-error" title={app.screening.flags.map((f) => `${f.reason} (${f.matchedVia})`).join("; ")}>
                            FLAG:{app.screening.flags.length}
                          </span>
                        )}
                        {app.screening?.tumaiVerification?.mismatch && (
                          <span className="inline-flex items-center rounded-full ad-bg-error px-2 py-0.5 text-[10px] font-bold ad-text-error" title="Claims TUM.ai membership but no match found">
                            TUM.ai?
                          </span>
                        )}
                        {app.screening?.tumaiVerification?.fuzzyMatch && (
                          <span className="inline-flex items-center rounded-full ad-bg-warning px-2 py-0.5 text-[10px] font-bold ad-text-gold" title={`Fuzzy match: ${app.screening.tumaiVerification.fuzzyMatch.matchedName} (${app.screening.tumaiVerification.fuzzyMatch.score}%)`}>
                            TUM.ai~
                          </span>
                        )}
                        {app.screening?.tumaiVerification?.verified && (
                          <span className="inline-flex items-center rounded-full ad-bg-success px-2 py-0.5 text-[10px] font-bold ad-text-success" title="TUM.ai membership verified">
                            TUM.ai
                          </span>
                        )}
                        {(app.screening?.noShows ?? 0) > 0 && (
                          <span className="inline-flex items-center rounded-full ad-bg-error px-2 py-0.5 text-[10px] font-bold ad-text-error" title={`${app.screening.noShows} no-show(s)`}>
                            NS:{app.screening.noShows}
                          </span>
                        )}
                        {(app.screening?.pastParticipations ?? 0) > 0 && (
                          <span className="inline-flex items-center rounded-full ad-bg-info px-2 py-0.5 text-[10px] font-bold ad-text-info" title={`${app.screening.pastParticipations} past event(s)`}>
                            PP:{app.screening.pastParticipations}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/chapters/${chapterId}/applications/${app.id}`}
                          className="text-sm ad-text-link transition-colors"
                        >
                          View
                        </Link>
                        {!locked && app.status === "pending" && (
                          <>
                            <button onClick={() => handleSingleStatus(app.id, "accepted")} disabled={acting} className="text-sm ad-text-success transition-colors">Accept</button>
                            <button onClick={() => handleSingleStatus(app.id, "rejected")} disabled={acting} className="text-sm ad-text-error transition-colors">Reject</button>
                          </>
                        )}
                        {!locked && app.status === "waitlisted" && (
                          <>
                            <button onClick={() => handleSingleStatus(app.id, "accepted")} disabled={acting} className="text-sm ad-text-success transition-colors">Accept</button>
                            <button onClick={() => handleSingleStatus(app.id, "rejected")} disabled={acting} className="text-sm ad-text-error transition-colors">Reject</button>
                          </>
                        )}
                        <button onClick={() => handleDelete(app.id)} disabled={acting} className="text-sm ad-text-muted hover:text-red-600 transition-colors" title="Delete application">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm ad-text-muted">
                    {applications.length === 0 ? "No applications yet." : "No applications match your filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Screening detail panel (slide-out) */}
      {activeApp && (
        <div className="fixed right-0 top-0 h-full w-[420px] overflow-y-auto border-l ad-border ad-bg-card shadow-lg z-40">
          <div className="sticky top-0 flex items-center justify-between border-b ad-border ad-bg-card px-6 py-4">
            <h2 className="ad-heading text-lg ad-text">
              {activeApp.firstName} {activeApp.lastName}
            </h2>
            <button
              onClick={() => setActiveApp(null)}
              className="rounded-lg p-1 ad-text-muted ad-bg-card-hover transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* League Info (prominent) */}
            {activeApp.screening?.isLeagueMember && (
              <div className="rounded-lg border ad-border-warning ad-bg-warning p-4">
                <p className="text-xs font-bold uppercase tracking-wider ad-text-gold mb-2">League Member</p>
                <div className="space-y-1 text-sm ad-text-secondary">
                  <p>Team: <strong className="ad-text-gold">{activeApp.screening.teamName}</strong></p>
                  <p>Points: <strong className="font-mono ad-text-gold">{activeApp.screening.totalPoints}</strong></p>
                  {activeApp.screening.pastParticipations > 0 && (
                    <p>Past events: <strong>{activeApp.screening.pastParticipations}</strong></p>
                  )}
                </div>
              </div>
            )}

            {/* Participant flags */}
            {(activeApp.screening?.flags?.length ?? 0) > 0 && activeApp.screening.flags.map((flag) => (
              <div key={flag.id} className={`rounded-lg border p-4 ${flag.matchedVia === "name" ? "ad-border-warning ad-bg-warning" : "ad-border-error ad-bg-error"}`}>
                <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${flag.matchedVia === "name" ? "ad-text-gold" : "ad-text-error"}`}>
                  Flagged Participant
                </p>
                <p className={`text-sm ${flag.matchedVia === "name" ? "ad-text-gold" : "ad-text-error"}`}>{flag.reason}</p>
                <p className="text-xs ad-text-muted mt-1">
                  By {flag.createdByName} on {new Date(flag.createdAt).toLocaleDateString("de-DE")} (matched via {flag.matchedVia})
                </p>
                {flag.screenshotUrl && (
                  <a href={flag.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-xs ad-text-link mt-1 inline-block">
                    View screenshot
                  </a>
                )}
              </div>
            ))}

            {/* No-show warning */}
            {(activeApp.screening?.noShows ?? 0) > 0 && (
              <div className="rounded-lg border ad-border-error ad-bg-error p-4">
                <p className="text-xs font-bold uppercase tracking-wider ad-text-error mb-1">No-Show Warning</p>
                <p className="text-sm ad-text-error">
                  Checked in but did not submit at {activeApp.screening.noShows} previous event(s).
                </p>
              </div>
            )}

            {/* Previous screening scores */}
            {activeApp.screening?.previousScores.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider ad-text-muted mb-2">Previous Screening Scores</p>
                <div className="space-y-1">
                  {activeApp.screening.previousScores.map((ps) => (
                    <div key={ps.chapterName} className="flex items-center justify-between text-sm">
                      <span className="ad-text-secondary">{ps.chapterName}</span>
                      <span className="font-mono font-bold ad-text">{ps.averageScore}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Application details */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider ad-text-muted mb-2">Application Details</p>
              <div className="space-y-2 text-sm">
                <DetailRow label="Email" value={activeApp.email} />
                <DetailRow label="Date of Birth" value={activeApp.formData?.dateOfBirth} />
                <DetailRow label="Gender" value={activeApp.formData?.gender} />
                <DetailRow label="Nationality" value={activeApp.formData?.nationality} />
                <DetailRow label="Location" value={[activeApp.formData?.city, activeApp.formData?.country].filter(Boolean).join(", ")} />
                <DetailRow label="University" value={activeApp.formData?.university} />
                <DetailRow label="Degree" value={activeApp.formData?.degree} />
                <DetailRow label="Field" value={activeApp.formData?.fieldOfStudy} />
                <DetailRow label="Programming" value={activeApp.formData?.hasProgrammingSkills ? "Yes" : "No"} />
                <DetailRow label="TUM.ai" value={activeApp.formData?.isTumaiMember ? "Yes" : "No"} />
                {activeApp.formData?.hackathonExperience && (
                  <div>
                    <span className="ad-text-muted">Experience:</span>
                    <p className="mt-1 ad-text-secondary">{activeApp.formData.hackathonExperience}</p>
                  </div>
                )}
                <DetailRow label="LinkedIn" value={activeApp.formData?.linkedIn} />
                <DetailRow label="GitHub" value={activeApp.formData?.github} />
                {activeApp.formData?.additionalNotes && (
                  <div>
                    <span className="ad-text-muted">Notes:</span>
                    <p className="mt-1 ad-text-secondary">{activeApp.formData.additionalNotes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* CV Preview */}
            {activeApp.cvUrl && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider ad-text-muted mb-2">CV</p>
                <div className="rounded-lg border ad-border overflow-hidden" style={{ height: "400px" }}>
                  <iframe
                    src={`/api/admin/cv/${activeApp.cvUrl}`}
                    className="h-full w-full"
                  />
                </div>
              </div>
            )}

            {/* Score input */}
            <div className="border-t ad-border pt-4">
              <p className="text-xs font-bold uppercase tracking-wider ad-text-muted mb-3">
                {hasSubmittedScore ? "Update Your Score" : "Score This Applicant"}
              </p>

              {/* Show existing scores (blind mode: hide other scores until I've submitted) */}
              {activeApp.screening.scores.length > 0 && (
                <div className="mb-4 space-y-2">
                  {activeApp.screening.scores.map((s, i) => {
                    const isMe = s.screenerId === myScreenerId;
                    if (!hasSubmittedScore && !isMe) {
                      return (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="ad-text-muted">{s.screenerName}:</span>
                          <span className="font-mono ad-text-muted">Hidden (submit your score first)</span>
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="ad-text-muted">{isMe ? "You" : s.screenerName}:</span>
                        <span className={`font-mono font-bold ${
                          s.score >= 7 ? "ad-text-success" : s.score >= 4 ? "ad-text-gold" : "ad-text-error"
                        }`}>
                          {s.score}/10
                        </span>
                        {s.notes && <span className="ad-text-muted text-xs">&quot;{s.notes}&quot;</span>}
                      </div>
                    );
                  })}
                  {hasSubmittedScore && activeApp.screening.averageScore !== null && (
                    <div className="flex items-center gap-2 text-sm font-bold border-t ad-border pt-2">
                      <span className="ad-text-secondary">Average:</span>
                      <span className="font-mono ad-text">{activeApp.screening.averageScore}/10</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-sm ad-text-muted mb-1">Score (1-10)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={scoreInput}
                      onChange={(e) => setScoreInput(parseInt(e.target.value))}
                      className="flex-1 accent-purple-700"
                    />
                    <span className="w-10 text-center font-mono text-lg font-bold ad-text">{scoreInput}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm ad-text-muted mb-1">Notes (optional)</label>
                  <textarea
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    rows={2}
                    placeholder="Quick notes on this applicant..."
                    className="w-full rounded-lg border ad-border ad-bg-card px-3 py-2 text-sm ad-text placeholder:ad-text-muted focus:outline-none resize-none"
                  />
                </div>
                <Button
                  onClick={handleSubmitScore}
                  disabled={submittingScore}
                  className="w-full"
                >
                  {submittingScore ? "Saving..." : hasSubmittedScore ? "Update Score" : "Submit Score"}
                </Button>
              </div>
            </div>

            {/* Quick status actions */}
            <div className="border-t ad-border pt-4">
              <p className="text-xs font-bold uppercase tracking-wider ad-text-muted mb-3">Quick Actions</p>
              {isStatusLocked(activeApp) ? (
                <p className="text-sm ad-text-muted">Status locked (email already sent).</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { handleSingleStatus(activeApp.id, "accepted"); setActiveApp(null); }}
                    disabled={acting || !canChangeStatus(activeApp, "accepted")}
                    className="rounded-lg ad-bg-success px-3 py-1.5 text-sm font-medium ad-text-success hover:bg-green-100 transition-colors disabled:opacity-40"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => { handleSingleStatus(activeApp.id, "rejected"); setActiveApp(null); }}
                    disabled={acting || !canChangeStatus(activeApp, "rejected")}
                    className="rounded-lg ad-bg-error px-3 py-1.5 text-sm font-medium ad-text-error hover:bg-red-100 transition-colors disabled:opacity-40"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => { handleSingleStatus(activeApp.id, "waitlisted"); setActiveApp(null); }}
                    disabled={acting || !canChangeStatus(activeApp, "waitlisted")}
                    className="rounded-lg ad-bg-warning px-3 py-1.5 text-sm font-medium ad-text-warning hover:bg-orange-100 transition-colors disabled:opacity-40"
                  >
                    Waitlist
                  </button>
                </div>
              )}

              {/* Delete */}
              <button
                onClick={() => handleDelete(activeApp.id)}
                disabled={acting}
                className="mt-2 w-full rounded-lg border ad-border-error ad-bg-card px-3 py-1.5 text-sm font-medium ad-text-error hover:bg-red-50 transition-colors disabled:opacity-40"
              >
                Delete Application
              </button>
            </div>

            {/* Add Flag */}
            <div className="border-t ad-border pt-4">
              <p className="text-xs font-bold uppercase tracking-wider ad-text-muted mb-3">Flag Participant</p>
              {showFlagForm ? (
                <div className="space-y-3">
                  <textarea
                    value={flagReason}
                    onChange={(e) => setFlagReason(e.target.value)}
                    rows={2}
                    placeholder="Reason for flagging..."
                    className="w-full rounded-lg border ad-border ad-bg-card px-3 py-2 text-sm ad-text placeholder:ad-text-muted focus:outline-none resize-none"
                  />
                  <p className="text-xs ad-text-muted">
                    Pre-filled: {activeApp.email}, {activeApp.firstName} {activeApp.lastName}
                    {activeApp.formData?.linkedIn ? `, LinkedIn` : ""}
                    {activeApp.formData?.github ? `, GitHub` : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleCreateFlag(activeApp)}
                      disabled={creatingFlag || !flagReason.trim()}
                    >
                      {creatingFlag ? "Creating..." : "Create Flag"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => { setShowFlagForm(false); setFlagReason(""); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowFlagForm(true)}
                  className="w-full rounded-lg border ad-border ad-bg-card px-3 py-1.5 text-sm font-medium ad-text-muted ad-bg-card-hover transition-colors"
                >
                  Add Flag
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="shrink-0 ad-text-muted">{label}:</span>
      <span className="ad-text-secondary">{value}</span>
    </div>
  );
}

function ScreeningDetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between">
      <span className="ad-text-muted">{label}</span>
      <span className="ad-text font-medium">{value}</span>
    </div>
  );
}

type SortCol = "name" | "email" | "score" | "league" | "status" | "date";

function SortHeader({
  col,
  label,
  sortCol,
  sortDir,
  onSort,
}: {
  col: SortCol;
  label: string;
  sortCol: SortCol;
  sortDir: "asc" | "desc";
  onSort: (col: SortCol) => void;
}) {
  const active = sortCol === col;
  return (
    <th
      className="pb-3 pr-4 font-medium cursor-pointer select-none hover:ad-text transition-colors"
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <svg className={`h-3 w-3 ${active ? "ad-text-link" : "ad-text-muted"}`} viewBox="0 0 10 14" fill="currentColor">
          <path d={active && sortDir === "asc"
            ? "M5 0L10 6H0L5 0Z"
            : active && sortDir === "desc"
              ? "M5 14L0 8H10L5 14Z"
              : "M5 0L10 6H0L5 0ZM5 14L0 8H10L5 14Z"
          } />
        </svg>
      </span>
    </th>
  );
}
