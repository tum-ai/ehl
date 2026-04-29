"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface TimelineScrollHighlightProps {
  children: ReactNode;
}

/**
 * Wraps a timeline entry and sets `data-scroll-active` when it is
 * closest to the vertical center of the viewport. Child elements
 * use the CSS selector `[data-scroll-active] .timeline-node` to
 * apply the active glow.
 */
export function TimelineScrollHighlight({ children }: TimelineScrollHighlightProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsActive(entry.isIntersecting);
      },
      {
        rootMargin: "-40% 0px -40% 0px",
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-scroll-active={isActive || undefined}>
      {children}
    </div>
  );
}
