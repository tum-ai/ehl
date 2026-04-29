import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getChaptersAdmin } from "@/lib/queries";
import { formatDate } from "@/lib/utils";

const statusVariant: Record<string, "completed" | "announced" | "upcoming"> = {
  completed: "completed",
  announced: "announced",
  applications_open: "announced",
  screening: "announced",
  registration_open: "announced",
  draft: "upcoming",
};

const statusLabel: Record<string, string> = {
  screening: "Preparation",
  registration_open: "Challenge Selection",
};

export default async function AdminChaptersPage() {
  const chapters = await getChaptersAdmin();
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-title text-2xl">Chapters</h1>
          <p className="mt-1 ad-text-secondary">
            Manage Season 1 matches
          </p>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b ad-border text-left text-sm ad-text-muted">
              <th className="pb-3 pr-4 font-medium">#</th>
              <th className="pb-3 pr-4 font-medium">Name</th>
              <th className="pb-3 pr-4 font-medium">City</th>
              <th className="pb-3 pr-4 font-medium">Date</th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter) => (
              <tr
                key={chapter.id}
                className="border-b ad-border ad-bg-card-hover transition-colors"
              >
                <td className="py-4 pr-4 ad-text-muted">
                  {chapter.matchNumber}
                </td>
                <td className="py-4 pr-4 font-semibold ad-text">{chapter.name}</td>
                <td className="py-4 pr-4 ad-text-secondary">
                  {chapter.city}, {chapter.country}
                </td>
                <td className="py-4 pr-4 ad-text-secondary">
                  {formatDate(chapter.date)}
                </td>
                <td className="py-4 pr-4">
                  <Badge variant={statusVariant[chapter.status] || "upcoming"} light>
                    {statusLabel[chapter.status] || chapter.status}
                  </Badge>
                </td>
                <td className="py-4">
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/chapters/${chapter.id}`}
                      className="text-sm font-medium ad-text-link transition-colors"
                    >
                      Edit
                    </Link>
                    {chapter.status === "completed" && (
                      <Link
                        href={`/admin/chapters/${chapter.id}/scores`}
                        className="text-sm font-medium ad-text-gold transition-colors"
                      >
                        Scores
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
