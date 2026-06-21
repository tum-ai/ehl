"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getChapterAdmins,
  inviteChapterAdmin,
  removeChapterAdmin,
} from "@/lib/actions/chapter-admins";

interface ChapterAdmin {
  userId: string;
  name: string | null;
  email: string | null;
  createdAt: string;
}

export function ChapterAdminsManager({ chapterId }: { chapterId: string }) {
  const [admins, setAdmins] = useState<ChapterAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    const result = await getChapterAdmins(chapterId);
    if ("error" in result && result.error) {
      setMessage({ type: "error", text: result.error });
    } else if ("admins" in result) {
      setAdmins(result.admins as ChapterAdmin[]);
    }
    setLoading(false);
  }, [chapterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setActing(true);
    setMessage(null);
    const result = await inviteChapterAdmin(email, name, chapterId);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({
        type: "success",
        text: `${email} can now log in via Google and administer this chapter.`,
      });
      setName("");
      setEmail("");
      await loadData();
    }
    setActing(false);
  }

  async function handleRemove(admin: ChapterAdmin) {
    if (
      !confirm(
        `Remove ${admin.email} as a local admin for this chapter? They will lose access on next login.`
      )
    )
      return;

    setActing(true);
    setMessage(null);
    const result = await removeChapterAdmin(admin.userId, chapterId);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `${admin.email} removed.` });
      await loadData();
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

  return (
    <div className="max-w-3xl">
      <h1 className="ad-title text-2xl">Local Admins</h1>
      <p className="mt-1 ad-text-secondary">
        Local admins can review screening, check people in, and view this
        chapter&apos;s teams and submissions. They cannot see other chapters or
        any global admin tooling.
      </p>

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

      {/* Invite a local admin */}
      <Card className="mt-6">
        <h2 className="ad-heading text-lg mb-4">Add Local Admin</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            required
            className="w-full rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
          />
          <div className="flex gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@partner.com"
              required
              className="flex-1 rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
            />
            <Button type="submit" disabled={acting}>
              Add
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs ad-text-muted">
          They log in at the admin login with Google using this email. Any email
          domain works, including external partners.
        </p>
      </Card>

      {/* Current local admins */}
      <Card className="mt-6">
        <h2 className="ad-heading text-lg mb-4">
          Current Local Admins
          <span className="ml-2 text-sm font-normal ad-text-muted">
            ({admins.length})
          </span>
        </h2>
        <div className="divide-y divide-gray-100">
          {admins.map((admin) => (
            <div
              key={admin.userId}
              className="flex items-center justify-between py-3"
            >
              <div>
                <p className="text-sm font-medium ad-text">
                  {admin.name || "Unknown"}
                </p>
                <p className="text-xs ad-text-muted">{admin.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="upcoming" light>
                  Local admin
                </Badge>
                <button
                  onClick={() => handleRemove(admin)}
                  disabled={acting}
                  className="text-sm ad-text-error hover:text-red-700 transition-colors disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {admins.length === 0 && (
            <p className="py-4 text-sm ad-text-muted">
              No local admins for this chapter yet.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
