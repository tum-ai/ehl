"use client";

import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import type { ChapterStats } from "@/lib/queries/admin-stats";

const ApplicationFunnel = dynamic(
  () =>
    import("./application-funnel").then((m) => ({
      default: m.ApplicationFunnel,
    })),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm ad-text-muted py-8">Loading chart...</p>
    ),
  }
);

const ChapterProgressChart = dynamic(
  () =>
    import("./chapter-progress-chart").then((m) => ({
      default: m.ChapterProgressChart,
    })),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm ad-text-muted py-8">Loading chart...</p>
    ),
  }
);

interface DashboardChartsProps {
  funnel: {
    applied: number;
    accepted: number;
    checkedIn: number;
    submitted: number;
  };
  chapters: ChapterStats[];
}

export function DashboardCharts({ funnel, chapters }: DashboardChartsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <ApplicationFunnel data={funnel} />
      </Card>
      <Card>
        <ChapterProgressChart chapters={chapters} />
      </Card>
    </div>
  );
}
