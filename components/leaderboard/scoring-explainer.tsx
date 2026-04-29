"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PLACEMENT_POINTS, PARTICIPATION_POINTS } from "@/lib/scoring";

export function ScoringExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-surface-card">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-5 text-left cursor-pointer"
      >
        <span className="text-sm font-medium text-text-secondary">
          How does scoring work?
        </span>
        <svg
          className={cn(
            "h-4 w-4 text-text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      <div
        className={cn(
          "overflow-hidden transition-all duration-300",
          open ? "max-h-[1000px]" : "max-h-0"
        )}
      >
        <div className="border-t border-white/10 p-5">
          {/* Placement table */}
          <h4 className="mb-3 text-sm font-medium text-text-secondary">
            Points per placement
          </h4>
          <div className="mb-6 space-y-2">
            {Object.entries(PLACEMENT_POINTS).map(([place, pts]) => (
              <div
                key={place}
                className="flex items-center justify-between rounded-lg bg-surface/50 px-4 py-2"
              >
                <span className="text-sm">
                  {place === "1"
                    ? "1st Place"
                    : place === "2"
                      ? "2nd Place"
                      : place === "3"
                        ? "3rd Place"
                        : `${place}th Place`}
                </span>
                <span className="font-mono font-bold text-ci-jasmine">+{pts}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg bg-surface/50 px-4 py-2">
              <span className="text-sm">Participate &amp; Submit</span>
              <span className="font-mono font-bold text-ci-jasmine">
                +{PARTICIPATION_POINTS}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface/50 px-4 py-2">
              <span className="text-sm">No Submission</span>
              <span className="font-mono font-bold text-text-muted">0</span>
            </div>
          </div>

          {/* Loyalty bonus */}
          <h4 className="mb-3 text-sm font-medium text-text-secondary">
            Loyalty bonus
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-ci-lavender/10 px-4 py-2">
              <span className="text-sm">
                Same roster across 3 matches in 2+ countries
              </span>
              <span className="font-mono font-bold text-ci-lavender">+6</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-ci-lavender/10 px-4 py-2">
              <span className="text-sm">Same roster across entire season</span>
              <span className="font-mono font-bold text-ci-lavender">+10</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
