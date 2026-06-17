"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ChapterStats } from "@/lib/queries/admin-stats";

interface ChapterProgressChartProps {
  chapters: ChapterStats[];
}

export function ChapterProgressChart({ chapters }: ChapterProgressChartProps) {
  // Only show non-draft chapters
  const data = chapters
    .filter((c) => c.status !== "draft")
    .map((c) => ({
      name: c.chapterName.length > 15
        ? c.chapterName.slice(0, 13) + "..."
        : c.chapterName,
      fullName: c.chapterName,
      Applied: c.applied,
      "Checked In": c.checkedIn,
      Registered: c.registrations,
      Submitted: c.submissions,
    }));

  if (data.length === 0) {
    return (
      <p className="text-sm ad-text-muted py-8 text-center">
        No chapter data available yet.
      </p>
    );
  }

  return (
    <div>
      <h3 className="ad-heading text-sm uppercase tracking-wider ad-text-muted mb-4">
        Per-Chapter Overview
      </h3>
      <div className="h-64">
        {/* Explicit pixel height (matches h-64 = 256px); see application-funnel:
            height="100%" against an unresolved-height parent made Recharts throw
            and blank the admin dashboard on some browsers. */}
        <ResponsiveContainer width="100%" height={256}>
          <BarChart data={data} margin={{ left: 0, right: 10 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={50}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              labelFormatter={(_, payload) => {
                const item = payload?.[0]?.payload;
                return item?.fullName || "";
              }}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "13px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar dataKey="Applied" fill="#6B7280" radius={[2, 2, 0, 0]} barSize={16} />
            <Bar dataKey="Checked In" fill="#22C55E" radius={[2, 2, 0, 0]} barSize={16} />
            <Bar dataKey="Registered" fill="#3B82F6" radius={[2, 2, 0, 0]} barSize={16} />
            <Bar dataKey="Submitted" fill="#E8B84B" radius={[2, 2, 0, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
