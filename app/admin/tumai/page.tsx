"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { uploadTumaiMembers, getTumaiMembers } from "@/lib/actions/tumai";

export default function TumaiAdminPage() {
  const [members, setMembers] = useState<{ email: string; name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getTumaiMembers().then((data) => {
      setMembers(data);
      setLoading(false);
    });
  }, []);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      if (lines.length === 0) {
        setMessage({ type: "error", text: "CSV file is empty." });
        setUploading(false);
        return;
      }

      // Parse header to find email column
      const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
      const emailIdx = header.findIndex((h) => h === "email" || h === "e-mail" || h === "mail");
      const nameIdx = header.findIndex((h) => h === "name" || h === "full name" || h === "fullname");

      if (emailIdx === -1) {
        setMessage({ type: "error", text: "CSV must have an 'email' column." });
        setUploading(false);
        return;
      }

      const parsed: { email: string; name: string | null }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/"/g, ""));
        const email = cols[emailIdx];
        if (email && email.includes("@")) {
          parsed.push({
            email,
            name: nameIdx >= 0 ? cols[nameIdx] || null : null,
          });
        }
      }

      if (parsed.length === 0) {
        setMessage({ type: "error", text: "No valid email addresses found in CSV." });
        setUploading(false);
        return;
      }

      const result = await uploadTumaiMembers(parsed);

      if (result.error) {
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({ type: "success", text: `Uploaded ${result.count} members. Previous list was replaced.` });
        setMembers(parsed);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to parse CSV file." });
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const filtered = search
    ? members.filter(
        (m) =>
          m.email.toLowerCase().includes(search.toLowerCase()) ||
          m.name?.toLowerCase().includes(search.toLowerCase())
      )
    : members;

  return (
    <div>
      <h1 className="ad-title text-2xl">TUM.ai Members</h1>
      <p className="mt-1 ad-text-secondary">
        Upload a CSV with member emails to verify TUM.ai membership during screening.
      </p>

      {/* Upload */}
      <Card className="mt-8">
        <h2 className="ad-heading text-lg">Upload Member List</h2>
        <p className="mt-1 text-sm ad-text-muted">
          CSV must have an &quot;email&quot; column. Optionally include a &quot;name&quot; column.
          This replaces the entire existing list.
        </p>
        <form onSubmit={handleUpload} className="mt-4 flex items-end gap-4">
          <div className="flex-1">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="w-full text-sm ad-text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-purple/20 file:px-4 file:py-2 file:text-sm file:font-medium file:text-purple-light hover:file:bg-purple/30"
            />
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? "Uploading..." : "Upload CSV"}
          </Button>
        </form>

        {message && (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              message.type === "success"
                ? "ad-border-success ad-bg-success ad-text-success"
                : "ad-border-error ad-bg-error ad-text-error"
            }`}
          >
            {message.text}
          </div>
        )}
      </Card>

      {/* Current members */}
      <Card className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="ad-heading text-lg">
            Current List ({members.length} members)
          </h2>
          {members.length > 0 && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="rounded-lg ad-border ad-bg-input px-3 py-1.5 text-sm ad-text placeholder:ad-text-muted focus:outline-none"
            />
          )}
        </div>

        {loading ? (
          <p className="mt-4 text-sm ad-text-muted">Loading...</p>
        ) : members.length === 0 ? (
          <p className="mt-4 text-sm ad-text-muted">
            No members uploaded yet. Upload a CSV to get started.
          </p>
        ) : (
          <div className="mt-4 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b ad-border text-left text-xs ad-text-muted">
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Name</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.email} className="border-b ad-border">
                    <td className="py-2 font-mono text-xs">{m.email}</td>
                    <td className="py-2 ad-text-secondary">{m.name || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {search && filtered.length === 0 && (
              <p className="mt-4 text-center text-sm ad-text-muted">
                No matches for &quot;{search}&quot;
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
