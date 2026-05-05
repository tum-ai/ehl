"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { geoInterpolate } from "d3-geo";
import { CI, CITIES, getCityPairs, EASING } from "@/lib/design-tokens";

interface ProjectedCity {
  name: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

interface NetworkArcsProps {
  cityProjections: ProjectedCity[];
  isVisible: boolean;
  isComplete: boolean;
}

// The order arcs are drawn: Munich connections first, then peer-to-peer
function getDrawOrder(): [string, string][] {
  return [
    ["Munich", "Paris"],
    ["Munich", "Berlin"],
    ["Munich", "Zurich"],
    ["Paris", "Berlin"],
    ["Paris", "Zurich"],
    ["Berlin", "Zurich"],
  ];
}

function buildArcPath(
  from: ProjectedCity,
  to: ProjectedCity,
  projection: (coords: [number, number]) => [number, number] | null,
  samples: number = 50
): string {
  const interpolator = geoInterpolate(
    [from.lng, from.lat],
    [to.lng, to.lat]
  );

  const points: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const geo = interpolator(t);
    const projected = projection(geo as [number, number]);
    if (projected) points.push(projected);
  }

  if (points.length < 2) return "";

  return (
    `M${points[0][0]},${points[0][1]}` +
    points
      .slice(1)
      .map(([x, y]) => `L${x},${y}`)
      .join("")
  );
}

export function NetworkArcs({
  cityProjections,
  isVisible,
  isComplete,
}: NetworkArcsProps) {
  const projection = useMemo(() => {
    const cityMap = new Map(
      cityProjections.map((c) => [c.name, c])
    );
    const cityCoords = new Map(
      CITIES.map((c) => [c.name, { lat: c.lat, lng: c.lng }])
    );

    return (coords: [number, number]): [number, number] | null => {
      // Simple linear interpolation based on known city positions
      // This won't be called -- we use geoInterpolate + the real projection from EuropeMap
      return coords;
    };
  }, [cityProjections]);

  // We don't use the above projection -- the parent passes one via the render prop pattern
  // Instead, we receive pre-projected cities and build arcs using them
  // But we need the real projection for great-circle arc intermediate points
  // So this component also receives the projection function as context

  return null; // Placeholder -- real implementation is in MapLayer
}

// The actual arc rendering used by MapLayer
export function NetworkArcPaths({
  cityProjections,
  projection,
  isVisible,
  isComplete,
}: NetworkArcsProps & {
  projection: (coords: [number, number]) => [number, number] | null;
}) {
  const drawOrder = getDrawOrder();

  const arcs = useMemo(() => {
    const cityMap = new Map(cityProjections.map((c) => [c.name, c]));
    return drawOrder.map(([fromName, toName]) => {
      const from = cityMap.get(fromName);
      const to = cityMap.get(toName);
      if (!from || !to) return { path: "", from: fromName, to: toName };
      return {
        path: buildArcPath(from, to, projection),
        from: fromName,
        to: toName,
      };
    });
  }, [cityProjections, projection]);

  return (
    <g>
      {arcs.map((arc, i) => {
        if (!arc.path) return null;

        // Estimate path length for dash animation
        const pathLength = 400;

        return (
          <g key={`${arc.from}-${arc.to}`}>
            {/* Base arc with draw animation */}
            <motion.path
              d={arc.path}
              fill="none"
              stroke={CI.jasmine}
              strokeWidth={1.2}
              strokeLinecap="round"
              opacity={0.6}
              style={{ filter: `drop-shadow(0 0 2px ${CI.jasmine})` }}
              strokeDasharray={pathLength}
              initial={{ strokeDashoffset: pathLength }}
              animate={
                isVisible
                  ? { strokeDashoffset: 0 }
                  : { strokeDashoffset: pathLength }
              }
              transition={{
                duration: 0.4,
                delay: i * 0.12,
                ease: EASING.enter,
              }}
            />

            {/* Traveling dot "current" effect (only when complete + in view) */}
            {isComplete && (
              <circle
                r={1.5}
                fill={CI.jasmine}
                opacity={0.8}
                style={{
                  offsetPath: `path("${arc.path}")`,
                  animation: `travel-dot ${6 + i * 0.8}s linear ${i * 1.2}s infinite`,
                }}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
