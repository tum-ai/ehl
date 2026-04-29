import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/actions/auth";
import { getJuryAssignmentsForUser, getChallengeById, getChapterById } from "@/lib/queries";
import { redirect } from "next/navigation";

export default async function JuryDashboard() {
  const session = await getSession();
  if (!session) redirect("/jury/login");

  const assignments = await getJuryAssignmentsForUser(session.user.id);

  // Load challenge and chapter details for each assignment
  const assignmentDetails = await Promise.all(
    assignments.map(async (a) => {
      const [challenge, chapter] = await Promise.all([
        getChallengeById(a.challengeId),
        getChapterById(a.chapterId),
      ]);
      return { assignment: a, challenge, chapter };
    })
  );

  function getVoteStatusBadge(status: string) {
    switch (status) {
      case "voted":
        return <Badge variant="completed">Voted</Badge>;
      case "skipped":
        return <Badge variant="upcoming">Skipped</Badge>;
      default:
        return null;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Jury Dashboard</h1>
      <p className="mt-1 text-text-secondary">
        Welcome, {session.profile?.name || "Jury Member"}
      </p>

      {assignmentDetails.length === 0 ? (
        <Card className="mt-8">
          <div className="text-center py-8">
            <p className="text-text-muted">No assignments yet.</p>
            <p className="mt-1 text-sm text-text-muted">
              You will see your challenge assignments here once you are invited.
            </p>
          </div>
        </Card>
      ) : (
        <div className="mt-8 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">
            Your Challenges
          </h2>
          {assignmentDetails.map(({ assignment, challenge, chapter }) => {
            if (!challenge || !chapter) return null;

            const isPitching = chapter.status === "pitching";
            const isCompleted = chapter.status === "completed";

            return (
              <Link
                key={assignment.challengeId}
                href={`/jury/${chapter.slug}`}
              >
                <Card className="transition-colors duration-200 hover:border-gold/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
                          Match {chapter.matchNumber}
                        </p>
                        <Badge
                          variant={
                            isCompleted
                              ? "completed"
                              : isPitching
                                ? "announced"
                                : "upcoming"
                          }
                        >
                          {chapter.status}
                        </Badge>
                        {getVoteStatusBadge(assignment.status)}
                      </div>
                      <p className="mt-1 text-lg font-bold">{challenge.title}</p>
                      <p className="text-sm text-text-secondary">
                        {chapter.name} &middot; {chapter.city}, {chapter.country}
                      </p>
                      {challenge.sponsorName && (
                        <p className="mt-1 text-xs text-text-muted">
                          by {challenge.sponsorName}
                        </p>
                      )}
                    </div>
                    <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
