"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { geoMercator, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import { motion } from "framer-motion";
import { CI, EASING } from "@/lib/design-tokens";
import type { Topology, GeometryCollection } from "topojson-specification";

interface EuropeMapProps {
  width: number;
  height: number;
  isVisible: boolean;
  onProjectionReady: (proj: GeoProjection) => void;
}

export function EuropeMap({
  width,
  height,
  isVisible,
  onProjectionReady,
}: EuropeMapProps) {
  const [countryPaths, setCountryPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Create a stable projection centered on Western Europe
  // Scale based on the smaller dimension to avoid clipping
  const projection = useMemo(() => {
    const scale = Math.min(width, height) * 1.1;
    return geoMercator()
      .center([10, 50])
      .scale(scale)
      .translate([width / 2, height / 2]);
  }, [width, height]);

  const pathGenerator = useMemo(() => geoPath(projection), [projection]);

  // Notify parent when projection is ready (only once per projection change)
  useEffect(() => {
    onProjectionReady(projection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);

  // Fetch and process TopoJSON
  useEffect(() => {
    let cancelled = false;

    async function loadMap() {
      try {
        const response = await fetch("/data/europe-50m.json");
        const topology = (await response.json()) as Topology<{
          countries: GeometryCollection;
        }>;
        const geoData = feature(topology, topology.objects.countries);

        if (cancelled) return;

        const paths = geoData.features
          .map((f) => pathGenerator(f) || "")
          .filter(Boolean);

        setCountryPaths(paths);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load Europe map:", err);
        setLoading(false);
      }
    }

    loadMap();
    return () => {
      cancelled = true;
    };
  }, [pathGenerator]);

  if (loading || countryPaths.length === 0) return null;

  return (
    <motion.g
      initial={{ opacity: 0, y: 20 }}
      animate={isVisible ? { opacity: 0.85, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.8, ease: EASING.enter }}
    >
      {/* Stipple pattern overlay */}
      <defs>
        <pattern
          id="stipple"
          x="0"
          y="0"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx="2.5"
            cy="2.5"
            r="0.6"
            fill={CI.lavender}
            opacity={0.15}
          />
        </pattern>
      </defs>

      {/* Country fills — single group fade (no per-path stagger for performance) */}
      {countryPaths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={CI.darkAmethyst}
          stroke={CI.lavender}
          strokeWidth={0.4}
          strokeOpacity={0.25}
        />
      ))}

      {/* Stipple overlay on all countries */}
      {countryPaths.map((d, i) => (
        <path key={`stipple-${i}`} d={d} fill="url(#stipple)" opacity={0.4} />
      ))}
    </motion.g>
  );
}
