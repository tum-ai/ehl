"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ApplicationFunnelProps {
  data: {
    applied: number;
    accepted: number;
    checkedIn: number;
    submitted: number;
  };
}

const COLORS = {
  applied: "#6B7280",
  accepted: "#3B82F6",
  checkedIn: "#22C55E",
  submitted: "#E8B84B",
};

export function ApplicationFunnel({ data }: ApplicationFunnelProps) {
  const chartData = [
    { name: "Applied", value: data.applied, color: COLORS.applied },
    { name: "Accepted", value: data.accepted, color: COLORS.accepted },
    { name: "Checked In", value: data.checkedIn, color: COLORS.checkedIn },
    { name: "Submitted", value: data.submitted, color: COLORS.submitted },
  ];

  return (
    <div>
      <h3 className="ad-heading text-sm uppercase tracking-wider ad-text-muted mb-4">
        Application Funnel
      </h3>
      <div className="h-56">
        {/* Explicit pixel height (matches h-56 = 224px). With height="100%",
            Recharts could measure a 0/-1-height parent during the ssr:false
            dynamic mount on some browsers/timings and fail to render — observed
            in the field as a client crash that blanked the whole admin content
            area. A fixed height removes the zero-height measurement entirely. */}
        <ResponsiveContainer width="100%" height={224}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={80}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(value) => [String(value), "Count"]}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "13px",
              }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Conversion rates */}
      <div className="mt-3 flex gap-4 text-xs ad-text-secondary">
        {data.applied > 0 && (
          <>
            <span>
              Accept rate: {Math.round((data.accepted / data.applied) * 100)}%
            </span>
            <span>
              Check-in rate:{" "}
              {data.accepted > 0
                ? Math.round((data.checkedIn / data.accepted) * 100)
                : 0}
              %
            </span>
            <span>
              Submission rate:{" "}
              {data.checkedIn > 0
                ? Math.round((data.submitted / data.checkedIn) * 100)
                : 0}
              %
            </span>
          </>
        )}
      </div>
    </div>
  );
}
