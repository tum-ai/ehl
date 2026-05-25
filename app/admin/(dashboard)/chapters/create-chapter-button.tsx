"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createNewChapter } from "@/lib/actions/admin";

export function CreateChapterButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    const result = await createNewChapter();
    if (result.id) {
      router.push(`/admin/chapters/${result.id}`);
    } else {
      setLoading(false);
      alert(result.error || "Failed to create chapter");
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border ad-border bg-white px-3 py-1.5 text-sm font-medium ad-text shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      {loading ? "Creating..." : "New Chapter"}
    </button>
  );
}
