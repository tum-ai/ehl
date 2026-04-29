/**
 * Filter world-atlas countries-50m.json to European countries only.
 * Run: node scripts/filter-europe-topo.mjs
 * Input: /tmp/countries-50m.json (download from cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json)
 * Output: public/data/europe-50m.json
 */

import { readFileSync, writeFileSync } from "fs";

// ISO 3166-1 numeric codes for Western/Central/Northern Europe
const EUROPE_IDS = new Set([
  "040", // Austria
  "056", // Belgium
  "100", // Bulgaria
  "070", // Bosnia and Herzegovina
  "191", // Croatia
  "203", // Czech Republic
  "208", // Denmark
  "233", // Estonia
  "246", // Finland
  "250", // France
  "276", // Germany
  "300", // Greece
  "348", // Hungary
  "372", // Ireland
  "380", // Italy
  "428", // Latvia
  "440", // Lithuania
  "442", // Luxembourg
  "499", // Montenegro
  "528", // Netherlands
  "578", // Norway
  "616", // Poland
  "620", // Portugal
  "642", // Romania
  "688", // Serbia
  "703", // Slovakia
  "705", // Slovenia
  "724", // Spain
  "752", // Sweden
  "756", // Switzerland
  "826", // United Kingdom
  "008", // Albania
  "807", // North Macedonia
]);

const world = JSON.parse(readFileSync("/tmp/countries-50m.json", "utf-8"));
const countries = world.objects.countries;

// Filter geometries to only European countries
const euroGeometries = countries.geometries.filter((g) => EUROPE_IDS.has(g.id));

// Collect all referenced arc indices
const referencedArcs = new Set();

function collectArcs(arcs) {
  if (typeof arcs === "number") {
    referencedArcs.add(arcs < 0 ? ~arcs : arcs);
    return;
  }
  if (Array.isArray(arcs)) {
    for (const a of arcs) collectArcs(a);
  }
}

for (const geom of euroGeometries) {
  if (geom.arcs) collectArcs(geom.arcs);
}

// Build a mapping from old arc index to new arc index
const oldToNew = new Map();
const newArcs = [];
const sortedRefs = [...referencedArcs].sort((a, b) => a - b);
for (const oldIdx of sortedRefs) {
  oldToNew.set(oldIdx, newArcs.length);
  newArcs.push(world.arcs[oldIdx]);
}

// Remap arc references in geometries
function remapArcs(arcs) {
  if (typeof arcs === "number") {
    const isReversed = arcs < 0;
    const oldIdx = isReversed ? ~arcs : arcs;
    const newIdx = oldToNew.get(oldIdx);
    return isReversed ? ~newIdx : newIdx;
  }
  if (Array.isArray(arcs)) {
    return arcs.map(remapArcs);
  }
  return arcs;
}

const remappedGeometries = euroGeometries.map((geom) => ({
  ...geom,
  arcs: geom.arcs ? remapArcs(geom.arcs) : geom.arcs,
}));

const result = {
  type: "Topology",
  arcs: newArcs,
  transform: world.transform,
  objects: {
    countries: {
      type: "GeometryCollection",
      geometries: remappedGeometries,
    },
  },
};

const output = JSON.stringify(result);
writeFileSync("public/data/europe-50m.json", output);
console.log(
  `Filtered ${remappedGeometries.length} European countries, ${newArcs.length} arcs (${(output.length / 1024).toFixed(1)}KB)`
);
