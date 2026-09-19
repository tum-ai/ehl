"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendFinaleInvites, type FinaleInviteTeam } from "@/lib/actions/finale-invites";
import { FINALE_INVITE_MAX_RANK } from "@/lib/finale";

interface Props {
  chapterId: string;
  chapterName: string;
  isFinale: boolean;
  teams: FinaleInviteTeam[];
  counts: { invited: number; in: number; out: number; awaiting: number; notInvited: number };
}

const btnClass =
  "rounded-lg bg-gradient-to-r from-gold to-gold-dark px-6 py-3 text-sm font-bold text-surface-deep transition-all hover:shadow-[0_0_20px_rgba(255,204,106,0.2)] disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * "Not invited" is the number the send button will actually mail, so it can
 * never promise work the button will not do (the lesson behind lib/rsvp-stats.ts).
 * A person on two qualifying teams is counted once, exactly as they are mailed
 * once.
 */
export function FinaleInvitesClient({
  chapterId,
  chapterName,
  isFinale,
  teams,
  counts,
}: Props) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSend() {
    const confirmed = window.confirm(
      `Send the Grand Finale invite to every member of the top ${FINALE_INVITE_MAX_RANK} teams who has not received it yet? ${counts.notInvited} person(s) will be emailed.`
    );
    if (!confirmed) return;

    setSending(true);
    setStatus(null);
    const result = await sendFinaleInvites(chapterId);
    setSending(false);

    if ("error" in result) {
      setStatus({ ok: false, text: result.error });
      return;
    }

    const parts = [`Sent ${result.sent} invite(s) across ${result.teams} qualifying team(s).`];
    if (result.remaining > 0) {
      parts.push(`${result.remaining} left, press again to continue.`);
    }
    if (result.failed.length > 0) {
      parts.push(`Failed: ${result.failed.join(", ")}. They keep no row, so a retry re-sends.`);
    }
    setStatus({ ok: result.failed.length === 0, text: parts.join(" ") });
    router.refresh();
  }

  const stats = [
    { label: "In", value: counts.in, color: "ad-text-success" },
    { label: "Out", value: counts.out, color: "ad-text-error" },
    { label: "No answer", value: counts.awaiting, color: "ad-text-warning" },
    { label: "Not invited", value: counts.notInvited, color: "ad-text-muted" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Grand Finale Invites</h1>
        <p className="mt-1 text-sm ad-text-muted">
          {chapterName}: every current member of a team ranked {FINALE_INVITE_MAX_RANK} or
          better gets a personal link. &quot;I&apos;m in&quot; accepts them and sends
          their check-in QR code, so they never fill in the application form.
        </p>
      </div>

      {!isFinale && (
        <div className="rounded-lg border ad-border-warning p-4">
          <p className="text-sm ad-text-warning">
            This match is not the Grand Finale, so invites cannot be sent from here.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border ad-border p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs ad-text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btnClass}
          onClick={handleSend}
          disabled={sending || !isFinale || counts.notInvited === 0}
        >
          {sending ? "Sending..." : `Send invites (${counts.notInvited})`}
        </button>
        <span className="text-xs ad-text-muted">
          Safe to press twice: anyone already invited is never emailed again.
        </span>
      </div>

      {status && (
        <div className={`rounded-lg border p-4 ${status.ok ? "ad-border" : "ad-border-error"}`}>
          <p className={`text-sm ${status.ok ? "" : "ad-text-error"}`}>{status.text}</p>
        </div>
      )}

      <div className="space-y-4">
        {teams.map((team) => {
          const answered = team.members.filter((m) => m.response === "yes").length;
          return (
            <div key={team.teamId} className="rounded-lg border ad-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-bold">
                  <span className="ad-text-muted">#{team.rank}</span> {team.teamName}
                </h2>
                <p className="text-xs ad-text-muted">
                  {team.points} pts · {answered} of {team.members.length} confirmed
                </p>
              </div>
              <ul className="mt-3 space-y-1">
                {team.members.map((m) => (
                  <li key={m.email} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>
                      {m.name || m.email}{" "}
                      <span className="ad-text-muted">{m.email}</span>
                    </span>
                    <span
                      className={
                        m.response === "yes"
                          ? "ad-text-success"
                          : m.response === "no"
                            ? "ad-text-error"
                            : m.invited
                              ? "ad-text-warning"
                              : "ad-text-muted"
                      }
                    >
                      {m.response === "yes"
                        ? m.accepted
                          ? "In, accepted"
                          : "In, NOT accepted"
                        : m.response === "no"
                          ? "Out"
                          : m.invited
                            ? "No answer"
                            : "Not invited"}
                    </span>
                  </li>
                ))}
              </ul>
              {team.members.length === 0 && (
                <p className="mt-2 text-sm ad-text-warning">
                  This team has no members on the platform, so nobody can be invited.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
