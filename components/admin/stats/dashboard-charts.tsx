"use client";

import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { ChartBoundary } from "./chart-boundary";
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
        <ChartBoundary label="The application funnel chart">
          <ApplicationFunnel data={funnel} />
        </ChartBoundary>
      </Card>
      <Card>
        <ChartBoundary label="The per-chapter chart">
          <ChapterProgressChart chapters={chapters} />
        </ChartBoundary>
      </Card>
    </div>
  );
}
