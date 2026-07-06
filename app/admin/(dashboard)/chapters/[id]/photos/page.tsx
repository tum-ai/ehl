"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChapterPhotosManager } from "@/components/admin/chapter-photos-manager";

interface ChapterInfo {
  id: string;
  name: string;
}

export default function AdminChapterPhotosPage() {
  const params = useParams();
  const chapterId = params.id as string;
  const [chapter, setChapter] = useState<ChapterInfo | null>(null);

  useEffect(() => {
    fetch(`/api/admin/chapters/${chapterId}/details`)
      .then((r) => r.json())
      .then(setChapter)
      .catch(() => null);
  }, [chapterId]);

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${chapterId}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to {chapter?.name || "chapter"}
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Match Photos</h1>
      <p className="mt-1 ad-text-secondary">{chapter?.name}</p>

      <div className="mt-6">
        <ChapterPhotosManager
          chapterId={chapterId}
          chapterName={chapter?.name ?? ""}
          description="Shown on the public chapter page once the match is completed, and in the partner showcase."
        />
      </div>
    </div>
  );
}
