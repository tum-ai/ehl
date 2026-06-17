"use client";

import { Component, type ReactNode } from "react";

/**
 * Error boundary around a single dashboard chart.
 *
 * Recharts' ResponsiveContainer can fail when it measures a 0/-1-sized parent
 * (seen during the ssr:false dynamic mount on some browsers/timings). In the
 * field this surfaced as a client crash that bubbled up and blanked the ENTIRE
 * admin dashboard — and, since admin tabs share one React root via <Link> soft
 * navigation, every tab clicked afterward also went blank. This keeps a chart
 * failure local: the rest of the dashboard renders and the broken chart shows a
 * small fallback, instead of taking down the whole admin shell.
 *
 * The underlying cause is also fixed (explicit pixel heights on the containers);
 * this is defense-in-depth so a chart can never blank the dashboard again.
 */
export class ChartBoundary extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[ChartBoundary] chart failed to render:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="ad-text-muted py-8 text-sm">
          {this.props.label ?? "This chart"} could not be displayed.
        </p>
      );
    }
    return this.props.children;
  }
}
