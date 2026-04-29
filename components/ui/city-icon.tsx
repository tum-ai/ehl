import { cn } from "@/lib/utils";

interface CityIconProps {
  city: string;
  className?: string;
}

export function CityIcon({ city, className }: CityIconProps) {
  const cls = cn("h-6 w-6", className);

  switch (city) {
    // Eiffel Tower - tapered lattice tower silhouette
    case "Paris":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          {/* Main legs */}
          <path d="M12 2l-5 20h10L12 2z" strokeWidth={0} />
          <path d="M7 22l5-20 5 20" />
          {/* Curved base legs */}
          <path d="M5 22l2.5-6M19 22l-2.5-6" />
          {/* Platform levels */}
          <path d="M8.5 12h7M9.5 8h5M7.5 16h9" />
          {/* Top antenna */}
          <path d="M12 2V0.5" />
          {/* Base */}
          <path d="M4 22h16" />
        </svg>
      );

    // Brandenburg Gate - 6 columns with entablature and quadriga
    case "Berlin":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          {/* Base */}
          <path d="M2 21h20" />
          {/* 6 columns */}
          <path d="M4 21V10M7.2 21V10M10.4 21V10M13.6 21V10M16.8 21V10M20 21V10" />
          {/* Entablature */}
          <path d="M3 10h18V8h-18z" />
          {/* Pediment / triangular top */}
          <path d="M6 8V6.5h12V8" />
          {/* Quadriga (chariot on top) */}
          <path d="M9 6.5V5h6v1.5" />
          <path d="M10.5 5c0-1.5 3-1.5 3 0" />
          {/* Quadriga horse/figure hint */}
          <path d="M12 3.5V2.5" />
        </svg>
      );

    // Frauenkirche - two onion-dome towers with church body
    case "Munich":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          {/* Base */}
          <path d="M3 22h18" />
          {/* Church body */}
          <path d="M5 22V10h14v12" />
          {/* Left tower */}
          <path d="M5 10V6h5v4" />
          {/* Left onion dome */}
          <path d="M5 6c0-1 0.5-2 2.5-2S10 5 10 6" />
          {/* Left cross */}
          <path d="M7.5 4V2.5M6.8 3.2h1.4" />
          {/* Right tower */}
          <path d="M14 10V6h5v4" />
          {/* Right onion dome */}
          <path d="M14 6c0-1 0.5-2 2.5-2S19 5 19 6" />
          {/* Right cross */}
          <path d="M16.5 4V2.5M15.8 3.2h1.4" />
          {/* Door */}
          <path d="M10 22v-5a2 2 0 014 0v5" />
          {/* Window */}
          <path d="M12 13a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
      );

    // Matterhorn - distinctive angular peak with snow
    case "Zurich":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          {/* Main peak - asymmetric Matterhorn shape */}
          <path d="M11 3l-9 19h20L13 6" />
          <path d="M11 3l2 3" />
          {/* Snow line */}
          <path d="M7.5 13l2-1.5 1.5 1 1.5-1.5 1.5 1.2" />
          {/* Background mountain */}
          <path d="M16 14l6 8" opacity={0.5} />
          <path d="M1 22l5-7" opacity={0.5} />
        </svg>
      );

    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
  }
}
