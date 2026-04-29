"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { GeoProjection } from "d3-geo";
import { CITIES, type HeroPhase, phaseReached } from "@/lib/design-tokens";
import { EuropeMap } from "./EuropeMap";
import { CityMarker } from "./CityMarker";
import { NetworkArcPaths } from "./NetworkArcs";

export interface CityPosition {
  name: string;
  x: number;
  y: number;
}

interface MapLayerProps {
  phase: HeroPhase;
  width: number;
  height: number;
  onCityPositions?: (positions: CityPosition[]) => void;
}

// Pulse periods per city (different so they're never in sync)
const PULSE_PERIODS: Record<string, number> = {
  Munich: 4,
  Paris: 5.2,
  Berlin: 4.6,
  Zurich: 5.8,
};

export default function MapLayer({ phase, width, height, onCityPositions }: MapLayerProps) {
  // Store projection in ref + trigger re-render with a counter
  // (useState with a function value would cause React to invoke it as an initializer)
  const projectionRef = useRef<GeoProjection | null>(null);
  const [, setProjectionVersion] = useState(0);

  const handleProjectionReady = useCallback((proj: GeoProjection) => {
    projectionRef.current = proj;
    setProjectionVersion((v) => v + 1);
  }, []);

  const projection = projectionRef.current;

  const mapVisible = phaseReached(phase, "map");
  const citiesVisible = phaseReached(phase, "cities");
  const networkVisible = phaseReached(phase, "network");
  const isComplete = phase === "complete";

  // Project city coordinates
  const cityProjections = useMemo(() => {
    if (!projection) return [];
    return CITIES.map((city) => {
      const projected = projection([city.lng, city.lat]);
      return {
        name: city.name,
        x: projected ? projected[0] : 0,
        y: projected ? projected[1] : 0,
        lat: city.lat,
        lng: city.lng,
        color: city.color,
        isOrigin: city.isOrigin,
      };
    });
  }, [projection]);

  // Report city positions to parent for star animation
  useEffect(() => {
    if (onCityPositions && cityProjections.length > 0) {
      onCityPositions(cityProjections.map(c => ({ name: c.name, x: c.x, y: c.y })));
    }
  }, [cityProjections, onCityPositions]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="europe-map"
      role="img"
      aria-label="Map of Europe showing EHL chapter cities: Munich, Paris, Berlin, Zurich"
    >
      <EuropeMap
        width={width}
        height={height}
        isVisible={mapVisible}
        onProjectionReady={handleProjectionReady}
      />

      {projection && cityProjections.length > 0 && (
        <>
          <NetworkArcPaths
            cityProjections={cityProjections}
            projection={(coords) => projection(coords)}
            isVisible={networkVisible}
            isComplete={isComplete}
          />

          {cityProjections.map((city, i) => (
            <CityMarker
              key={city.name}
              cx={city.x}
              cy={city.y}
              name={city.name}
              color={city.color}
              isOrigin={city.isOrigin}
              isVisible={citiesVisible}
              isComplete={isComplete}
              pulsePeriod={PULSE_PERIODS[city.name] ?? 5}
              showLabel={width > 500}
            />
          ))}
        </>
      )}
    </svg>
  );
}
