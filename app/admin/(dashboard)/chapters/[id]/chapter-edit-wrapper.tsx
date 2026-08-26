"use client";

import { useState } from "react";
import { StatusControl } from "./status-control";
import { ChapterEditForm } from "./chapter-edit-form";
import type { ChapterStatus } from "@/lib/types";

interface ChapterEditWrapperProps {
  chapterId: string;
  initialStatus: ChapterStatus;
  initialData: {
    name: string;
    city: string;
    country: string;
    description: string;
    date: string | null;
    dateEnd: string | null;
    heroImageUrl: string | null;
    photoAlbumUrl: string | null;
    challengeRegistrationEnabled: boolean;
    requireCv: boolean;
    requireMotivation: boolean;
    applicationDeadline: string | null;
    challengeSelectionDeadline: string | null;
    submissionDeadline: string | null;
  };
  children?: React.ReactNode;
}

export function ChapterEditWrapper({
  chapterId,
  initialStatus,
  initialData,
  children,
}: ChapterEditWrapperProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <StatusControl
        chapterId={chapterId}
        initialStatus={initialStatus}
        refreshKey={refreshKey}
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChapterEditForm
          chapterId={chapterId}
          initialData={initialData}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
        {children}
      </div>
    </>
  );
}
