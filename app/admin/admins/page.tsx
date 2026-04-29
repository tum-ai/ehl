"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getAdminUsers,
  addAdminEmail,
  removeAdminEmail,
} from "@/lib/actions/admin-users";

interface AdminProfile {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
}

interface AllowlistEntry {
  id: string;
  email: string;
  created_at: string;
}

export default function AdminManagerPage() {
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function loadData() {
    const result = await getAdminUsers();
    if ("error" in result && result.error) {
      setMessage({ type: "error", text: result.error });
    } else if ("admins" in result) {
      setAdmins(result.admins as AdminProfile[]);
      setAllowlist(result.allowlist as AllowlistEntry[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setActing(true);
    setMessage(null);
    const result = await addAdminEmail(newEmail);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `${newEmail} added to admin allowlist.` });
      setNewEmail("");
      await loadData();
    }
    setActing(false);
  }

  async function handleRemove(email: string) {
    if (!confirm(`Remove ${email} from the admin allowlist? They will lose admin access on next login.`)) return;

    setActing(true);
    setMessage(null);
    const result = await removeAdminEmail(email);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `${email} removed from admin allowlist.` });
      await loadData();
    }
    setActing(false);
  }

  if (loading) {
    return <div><p className="ad-text-muted">Loading...</p></div>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="ad-title text-2xl">Admin Management</h1>
      <p className="mt-1 ad-text-secondary">
        Manage who can access the admin panel.
      </p>

      {message && (
        <p className={`mt-4 rounded-lg px-4 py-3 text-sm ${
          message.type === "error" ? "ad-bg-error ad-text-error" : "ad-bg-success ad-text-success"
        }`}>
          {message.text}
        </p>
      )}

      {/* Add new admin */}
      <Card className="mt-6">
        <h2 className="ad-heading text-lg mb-4">Add Admin</h2>
        <form onSubmit={handleAdd} className="flex gap-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@your-org.com"
            required
            className="flex-1 rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
          />
          <Button type="submit" disabled={acting}>
            Add
          </Button>
        </form>
        <p className="mt-2 text-xs ad-text-muted">
          The person can log in via Google with this email after being added.
        </p>
      </Card>

      {/* Allowlisted emails */}
      <Card className="mt-6">
        <h2 className="ad-heading text-lg mb-4">
          Allowlisted Emails
          <span className="ml-2 text-sm font-normal ad-text-muted">({allowlist.length})</span>
        </h2>
        <div className="divide-y divide-gray-100">
          {allowlist.map((entry) => {
            const hasProfile = admins.some((a) => a.email === entry.email);
            return (
              <div key={entry.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium ad-text">{entry.email}</p>
                    <p className="text-xs ad-text-muted">
                      Added {new Date(entry.created_at).toLocaleDateString("de-DE")}
                    </p>
                  </div>
                  {hasProfile ? (
                    <Badge variant="completed" light>Active</Badge>
                  ) : (
                    <Badge variant="upcoming" light>Not logged in yet</Badge>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(entry.email)}
                  disabled={acting}
                  className="text-sm ad-text-error hover:text-red-700 transition-colors disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            );
          })}
          {allowlist.length === 0 && (
            <p className="py-4 text-sm ad-text-muted">No admin emails configured.</p>
          )}
        </div>
      </Card>

      {/* Active admin profiles */}
      <Card className="mt-6">
        <h2 className="ad-heading text-lg mb-4">
          Active Admin Sessions
          <span className="ml-2 text-sm font-normal ad-text-muted">({admins.length})</span>
        </h2>
        <p className="text-xs ad-text-muted mb-4">
          Admins who have logged in at least once.
        </p>
        <div className="divide-y divide-gray-100">
          {admins.map((admin) => {
            const onAllowlist = allowlist.some((e) => e.email === admin.email);
            return (
              <div key={admin.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium ad-text">
                    {admin.name || "Unknown"}
                  </p>
                  <p className="text-xs ad-text-muted">{admin.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!onAllowlist && (
                    <Badge variant="default" light>Not on allowlist</Badge>
                  )}
                </div>
              </div>
            );
          })}
          {admins.length === 0 && (
            <p className="py-4 text-sm ad-text-muted">No active admin sessions.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
