"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Types ──────────────────────────────────────────────

interface EventLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  actor_type: string;
  actor_name: string | null;
  delta: Record<string, unknown>;
  metadata: Record<string, unknown>;
  entry_hash: string;
  created_at: string;
}

interface LogsResponse {
  entries: EventLogEntry[];
  total: number;
  page: number;
  limit: number;
}

interface VerifyResult {
  intact: boolean;
  brokenAt?: string;
  totalEntries: number;
}

// ─── Severity Classification ────────────────────────────

function getSeverity(action: string): "error" | "warning" | "info" {
  if (action.startsWith("client.error") || action.includes(".error")) return "error";
  if (action.includes(".failed") || action.includes(".rejected")) return "warning";
  return "info";
}

function SeverityBadge({ action }: { action: string }) {
  const severity = getSeverity(action);
  const styles = {
    error: "bg-red-100 text-red-700 border-red-200",
    warning: "bg-amber-100 text-amber-700 border-amber-200",
    info: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[severity]}`}>
      {severity === "error" && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />}
      {severity}
    </span>
  );
}

// ─── Relative Time ──────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Delta Summary ──────────────────────────────────────

function deltaSummary(delta: Record<string, unknown>): string {
  if (!delta || typeof delta !== "object") return "";
  const keys = Object.keys(delta);
  if (keys.length === 0) return "";

  // Status change
  if (delta.status && typeof delta.status === "object") {
    const s = delta.status as { from?: string; to?: string };
    return `${s.from ?? "?"} → ${s.to ?? "?"}`;
  }

  // Created
  if (delta.created && typeof delta.created === "object") {
    const c = delta.created as Record<string, unknown>;
    const summary = Object.entries(c)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return summary || "created";
  }

  // Deleted
  if (delta.deleted && typeof delta.deleted === "object") {
    return "deleted";
  }

  // Fallback: show first key
  return keys.slice(0, 2).join(", ");
}

// ─── Filters Bar ────────────────────────────────────────

function FiltersBar({
  filters,
  setFilters,
}: {
  filters: { action: string; entityType: string; actorType: string; from: string; to: string };
  setFilters: (f: typeof filters) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <input
        type="text"
        placeholder="Filter by action..."
        value={filters.action}
        onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-400 focus:outline-none"
      />
      <select
        value={filters.entityType}
        onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
      >
        <option value="">All entities</option>
        <option value="chapter">Chapter</option>
        <option value="team">Team</option>
        <option value="application">Application</option>
        <option value="submission">Submission</option>
        <option value="score">Score</option>
        <option value="challenge">Challenge</option>
        <option value="error">Error</option>
        <option value="profile">Profile</option>
        <option value="app_setting">Setting</option>
      </select>
      <select
        value={filters.actorType}
        onChange={(e) => setFilters({ ...filters, actorType: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
      >
        <option value="">All actors</option>
        <option value="admin">Admin</option>
        <option value="participant">Participant</option>
        <option value="jury">Jury</option>
        <option value="system">System</option>
      </select>
      <input
        type="datetime-local"
        value={filters.from}
        onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
        title="From"
      />
      <input
        type="datetime-local"
        value={filters.to}
        onChange={(e) => setFilters({ ...filters, to: e.target.value })}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
        title="To"
      />
      {(filters.action || filters.entityType || filters.actorType || filters.from || filters.to) && (
        <button
          onClick={() => setFilters({ action: "", entityType: "", actorType: "", from: "", to: "" })}
          className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ─── Log Row ────────────────────────────────────────────

function LogRow({ entry }: { entry: EventLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="shrink-0 pt-0.5 text-xs text-slate-400 font-mono w-16">
          {timeAgo(entry.created_at)}
        </span>
        <span className="shrink-0 pt-0.5">
          <SeverityBadge action={entry.action} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-sm text-slate-800">{entry.action}</span>
          <span className="ml-2 text-xs text-slate-500">
            {entry.entity_type}
            {entry.entity_id && entry.entity_id !== "bulk" && entry.entity_id !== "batch" && (
              <span className="font-mono">:{entry.entity_id.slice(0, 8)}</span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs text-slate-500">
          {entry.actor_name ?? entry.actor_type}
        </span>
        <span className="shrink-0 text-xs text-slate-400 max-w-48 truncate">
          {deltaSummary(entry.delta)}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="bg-slate-50 px-4 py-3 border-t border-slate-100">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-medium text-slate-500 mb-1">Delta</p>
              <pre className="bg-white rounded p-2 text-slate-700 overflow-x-auto border border-slate-200">
                {JSON.stringify(entry.delta, null, 2)}
              </pre>
            </div>
            <div>
              <p className="font-medium text-slate-500 mb-1">Details</p>
              <div className="space-y-1 text-slate-600">
                <p><span className="text-slate-400">ID:</span> <span className="font-mono">{entry.id}</span></p>
                <p><span className="text-slate-400">Time:</span> {new Date(entry.created_at).toLocaleString()}</p>
                <p><span className="text-slate-400">Actor:</span> {entry.actor_name ?? "N/A"} ({entry.actor_type})</p>
                <p><span className="text-slate-400">Entity:</span> {entry.entity_type}:{entry.entity_id}</p>
                <p><span className="text-slate-400">Hash:</span> <span className="font-mono">{entry.entry_hash?.slice(0, 16)}...</span></p>
              </div>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <>
                  <p className="font-medium text-slate-500 mb-1 mt-2">Metadata</p>
                  <pre className="bg-white rounded p-2 text-slate-700 overflow-x-auto border border-slate-200">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

export default function AdminLogsPage() {
  const [tab, setTab] = useState<"live" | "audit">("live");
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ action: "", entityType: "", actorType: "", from: "", to: "" });
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const limit = tab === "live" ? 50 : 25;

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      if (filters.action) params.set("action", filters.action);
      if (filters.entityType) params.set("entity_type", filters.entityType);
      if (filters.actorType) params.set("actor_type", filters.actorType);
      if (filters.from) params.set("from", new Date(filters.from).toISOString());
      if (filters.to) params.set("to", new Date(filters.to).toISOString());

      const res = await fetch(`/api/admin/logs?${params}`);
      if (res.ok) {
        const data: LogsResponse = await res.json();
        setEntries(data.entries);
        setTotal(data.total);
      }
    } catch {
      // Silent fail for auto-refresh
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, limit, search, filters]);

  // Initial load + filter/page changes
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh for live tab
  useEffect(() => {
    if (tab === "live" && autoRefresh) {
      intervalRef.current = setInterval(() => fetchLogs(true), 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tab, autoRefresh, fetchLogs]);

  // Reset page when filters/tab/search change
  useEffect(() => {
    setPage(1);
  }, [filters, tab, search]);

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/logs/verify");
      if (res.ok) {
        setVerifyResult(await res.json());
      }
    } catch {
      setVerifyResult({ intact: false, brokenAt: "fetch_error", totalEntries: 0 });
    } finally {
      setVerifying(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Fetch all entries matching current filters (paginated)
      const allEntries: EventLogEntry[] = [];
      let exportPage = 1;
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams({ page: String(exportPage), limit: "200" });
        if (search) params.set("search", search);
        if (filters.action) params.set("action", filters.action);
        if (filters.entityType) params.set("entity_type", filters.entityType);
        if (filters.actorType) params.set("actor_type", filters.actorType);
        if (filters.from) params.set("from", new Date(filters.from).toISOString());
        if (filters.to) params.set("to", new Date(filters.to).toISOString());

        const res = await fetch(`/api/admin/logs?${params}`);
        if (!res.ok) break;
        const data: LogsResponse = await res.json();
        allEntries.push(...data.entries);
        hasMore = allEntries.length < data.total;
        exportPage++;
        if (exportPage > 50) break; // Safety limit: 10k entries max
      }

      // Build CSV
      const headers = ["id", "created_at", "action", "entity_type", "entity_id", "actor_type", "actor_id", "actor_name", "delta", "entry_hash"];
      const csvRows = [headers.join(",")];
      for (const e of allEntries) {
        csvRows.push(headers.map(h => {
          const val = h === "delta" ? JSON.stringify(e.delta) : (e as unknown as Record<string, unknown>)[h] ?? "";
          const str = String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(","));
      }

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ehl-audit-log-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-900">Event Logs</h1>
      <p className="mt-1 text-sm text-slate-500">Live monitoring and audit trail for all platform events</p>

      {/* Tab bar */}
      <div className="mt-6 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("live")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "live"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span className="flex items-center gap-2">
            {autoRefresh && tab === "live" && <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />}
            Live Feed
          </span>
        </button>
        <button
          onClick={() => setTab("audit")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "audit"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Audit Trail
        </button>
      </div>

      {/* Search */}
      <div className="mt-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search across all fields (actions, entities, delta content, IDs...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <FiltersBar filters={filters} setFilters={setFilters} />

      {/* Live tab controls */}
      {tab === "live" && (
        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            Auto-refresh (5s)
          </label>
          <span className="text-xs text-slate-400">{total} events total</span>
        </div>
      )}

      {/* Audit tab controls */}
      {tab === "audit" && (
        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={handleVerify}
            disabled={verifying}
            className="ad-btn-secondary text-sm"
          >
            {verifying ? "Verifying..." : "Verify Chain"}
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="ad-btn-secondary text-sm"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
          {verifyResult && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              verifyResult.intact
                ? "bg-green-100 text-green-700 border border-green-200"
                : "bg-red-100 text-red-700 border border-red-200"
            }`}>
              {verifyResult.intact ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Chain Intact ({verifyResult.totalEntries} entries)
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Chain Broken at {verifyResult.brokenAt}
                </>
              )}
            </span>
          )}
          <span className="text-xs text-slate-400">{total} events total</span>
        </div>
      )}

      {/* Log entries */}
      <Card className="mt-4 ad-card overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading events...</div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No events found</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {entries.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Card>

      {/* Pagination (audit tab) */}
      {tab === "audit" && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="ad-btn-secondary text-sm"
          >
            Previous
          </Button>
          <span className="text-sm text-slate-500">
            Page {page} of {totalPages}
          </span>
          <Button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="ad-btn-secondary text-sm"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
