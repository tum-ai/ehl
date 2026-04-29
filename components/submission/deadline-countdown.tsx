"use client";

import { useState, useEffect } from "react";
import { formatDeadline } from "@/lib/utils";

interface DeadlineCountdownProps {
  deadline: string;
  label?: string;
  activeMessage?: string;
  expiredMessage?: string;
}

function getTimeLeft(deadline: string) {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return { days, hours, minutes, seconds, total: diff };
}

export function DeadlineCountdown({
  deadline,
  label = "Submission Deadline",
  activeMessage = "You can edit your submission until the deadline.",
  expiredMessage = "Deadline has passed. Submissions are locked.",
}: DeadlineCountdownProps) {
  // Start with null to avoid hydration mismatch (server time != client time)
  const [timeLeft, setTimeLeft] = useState<ReturnType<typeof getTimeLeft>>(undefined as never);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTimeLeft(getTimeLeft(deadline));
    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  const isUrgent = timeLeft && timeLeft.total < 1000 * 60 * 60; // < 1 hour
  const borderColor = isUrgent ? "border-red-500/30" : "border-gold/20";
  const bgColor = isUrgent ? "bg-red-500/[0.03]" : "bg-gold/[0.03]";

  return (
    <div className={`mt-8 rounded-2xl border ${borderColor} ${bgColor} p-6 text-center`}>
      <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p className="mt-1 text-lg font-mono text-text-secondary">
        {formatDeadline(deadline)}
      </p>

      {!mounted ? (
        // Server render: show static placeholder, no time-dependent content
        <div className="mt-4 h-12" />
      ) : timeLeft ? (
        <div className="mt-4 flex items-center justify-center gap-3">
          {timeLeft.days > 0 && (
            <TimeUnit value={timeLeft.days} label="days" urgent={!!isUrgent} />
          )}
          <TimeUnit value={timeLeft.hours} label="hrs" urgent={!!isUrgent} />
          <span className={`text-xl font-bold ${isUrgent ? "text-red-400" : "text-gold/40"}`}>:</span>
          <TimeUnit value={timeLeft.minutes} label="min" urgent={!!isUrgent} />
          <span className={`text-xl font-bold ${isUrgent ? "text-red-400" : "text-gold/40"}`}>:</span>
          <TimeUnit value={timeLeft.seconds} label="sec" urgent={!!isUrgent} />
        </div>
      ) : (
        <p className="mt-3 text-sm font-medium text-red-400">
          {expiredMessage}
        </p>
      )}

      {mounted && timeLeft && activeMessage && (
        <p className="mt-3 text-sm text-text-muted">
          {activeMessage}
        </p>
      )}
    </div>
  );
}

function TimeUnit({ value, label, urgent }: { value: number; label: string; urgent: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-3xl font-mono font-bold tabular-nums ${urgent ? "text-red-400" : "text-gold"}`}>
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
    </div>
  );
}
