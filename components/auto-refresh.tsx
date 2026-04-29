"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL = 60_000; // 60 seconds

export function AutoRefresh() {
  const router = useRouter();
  const versionRef = useRef<string | null>(null);

  useEffect(() => {
    // Don't poll if the tab is hidden
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { v } = await res.json();

        if (versionRef.current !== null && versionRef.current !== v) {
          router.refresh();
        }
        versionRef.current = v;
      } catch {
        // Network error, skip this tick
      }
    }

    function scheduleNext() {
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") {
          await check();
        }
        scheduleNext();
      }, POLL_INTERVAL);
    }

    // Initial check to seed the version
    check();
    scheduleNext();

    // Re-check when tab becomes visible after being hidden
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        check();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
