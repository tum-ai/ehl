import Link from "next/link";
import { requireGlobalAdminPage } from "@/lib/admin-auth";
import { ChapterAdminsManager } from "./chapter-admins-manager";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ChapterAdminsPage({ params }: PageProps) {
  // Only GLOBAL admins manage local admins; a local admin hitting this is
  // bounced back to their own chapter.
  await requireGlobalAdminPage();
  const { id } = await params;

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${id}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to chapter
        </Link>
      </div>
      <ChapterAdminsManager chapterId={id} />
    </div>
  );
}
