import polylabel from "polylabel";

export type Ring = number[][];           // [ [lng, lat], ... ]
export type Rings = Ring[];              // outer ring + holes
export type LatLng = [number, number];   // [lat, lng]
export interface PolyPart { rings: Rings; area: number; }

/** Shoelace area (absolute) of a ring, in deg². */
export function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(s / 2);
}

/**
 * "Unwrap" longitudes so a ring that crosses the antimeridian (±180°) stays
 * continuous. Without this, antimeridian-crossing parts (Alaska, Chukotka) get
 * a bogus ~360°-wide bounding box, which both breaks the largest-part pick and
 * sends polylabel into the middle of the Pacific.
 */
export function normRing(ring: Ring): Ring {
  const out: Ring = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    let cur = ring[i][0];
    const d = cur - out[i - 1][0];
    if (d > 180) cur -= 360;
    else if (d < -180) cur += 360;
    out.push([cur, ring[i][1]]);
  }
  return out;
}

export function wrapLng(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

/** Average-of-vertices centroid (last-resort fallback). Returns [lng, lat]. */
export function ringCentroid(ring: Ring): [number, number] {
  let x = 0, y = 0;
  let m = ring.length - 1; // skip the closing duplicate point
  if (m < 1) m = ring.length;
  for (let i = 0; i < m; i++) { x += ring[i][0]; y += ring[i][1]; }
  return [x / m, y / m];
}

/**
 * All polygon parts of a GeoJSON geometry as { rings, area }, longitudes
 * unwrapped, sorted largest-first. parts[0] is the main landmass.
 */
export function allPolygonParts(geom: any): PolyPart[] {
  if (!geom) return [];
  const polys: Rings[] =
    geom.type === "Polygon" ? [geom.coordinates]
    : geom.type === "MultiPolygon" ? geom.coordinates
    : [];
  return polys
    .map((poly) => {
      const rings = poly.map(normRing);
      return { rings, area: ringArea(rings[0]) };
    })
    .sort((a, b) => b.area - a.area);
}

/**
 * Visual center (pole of inaccessibility) of a set of unwrapped rings, wrapped
 * back into [-180, 180]. Returns [lat, lng] for Leaflet.
 */
export function centerOf(rings: Rings): LatLng {
  try {
    const p = polylabel(rings, 1.0); // [lng, lat], unwrapped space
    return [p[1], wrapLng(p[0])];
  } catch {
    const c = ringCentroid(rings[0]);
    return [c[1], wrapLng(c[0])];
  }
}
