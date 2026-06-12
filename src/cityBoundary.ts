// Resolve a city's administrative boundary from OpenStreetMap (Nominatim).
//
// Pure logic — no Leaflet/DOM — so it is unit-testable (places.ts draws whatever
// this returns). The hard cases this handles:
//   - small towns:     reverse-geocode returns the municipality polygon directly.
//   - big cities:      reverse returns the place *node* (a point); its address
//                      still names the municipality (e.g. "Københavns Kommune"),
//                      which we then search for.
//   - ambiguous names: "New York"/"Tokyo" surface the state/prefecture first, so
//                      we reject oversized matches and require the polygon to
//                      contain the city point.
//   - sub-city units:  at big-city centres /reverse?zoom=10 can return a borough/
//                      ward polygon (Manhattan for New York, Chiyoda for Tokyo)
//                      that passes the size filter — so the reverse polygon is
//                      only accepted when its name loosely matches the city's.

export const MAX_CITY_KM = 120; // reject admin areas bigger than a real city (states, prefectures)

export interface CityBoundary {
  geom: GeoJSONGeom | null;
  source: "reverse" | "addr:municipality" | "addr:city" | "addr:town" | "addr:county" | "name-search" | "none";
}

type GeoJSONGeom = { type: string; coordinates: any };

function geomOf(obj: any): GeoJSONGeom | null {
  const g = obj && obj.geojson;
  return g && (g.type === "Polygon" || g.type === "MultiPolygon") ? g : null;
}

// Diagonal of a geometry's bounding box, in km (cos-latitude corrected).
export function geomExtentKm(geom: GeoJSONGeom): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (a: any) => {
    if (typeof a[0] === "number") {
      if (a[0] < minX) minX = a[0]; if (a[0] > maxX) maxX = a[0];
      if (a[1] < minY) minY = a[1]; if (a[1] > maxY) maxY = a[1];
    } else for (const c of a) walk(c);
  };
  if (geom && geom.coordinates) walk(geom.coordinates);
  const midLat = (minY + maxY) / 2;
  const w = (maxX - minX) * 111 * Math.cos(midLat * Math.PI / 180), h = (maxY - minY) * 111;
  return Math.sqrt(w * w + h * h);
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// True if [lng,lat] is inside the polygon/multipolygon (outer ring minus holes).
export function geomContains(lng: number, lat: number, geom: GeoJSONGeom): boolean {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  return polys.some((rings: number[][][]) => rings.length > 0 && pointInRing(lng, lat, rings[0]) && !rings.slice(1).some((h) => pointInRing(lng, lat, h)));
}

function reverseFull(lat: number, lng: number, zoom: number): Promise<any> {
  return fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&polygon_geojson=1&namedetails=1&zoom=" + zoom + "&lat=" + lat + "&lon=" + lng, { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

// Normalised, diacritic-free lowercase for name comparison.
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
// Loose name match between the city being resolved and a Nominatim result: true
// when either name contains the other ("Sorø Kommune" ~ "Sorø", "City of New
// York" ~ "New York"; "Manhattan"/"千代田区" do NOT match "New York"/"Tokyo").
// A result exposing no usable name at all passes (we can't judge it).
export function nameMatches(city: string, r: any): boolean {
  const c = norm(city);
  if (!c) return true;
  const nd = (r && r.namedetails) || {};
  const names = [r && r.name, nd.name, nd["name:en"], r && r.display_name && String(r.display_name).split(",")[0]]
    .filter((n) => n && String(n).trim());
  if (!names.length) return true;
  return names.some((n) => {
    const x = norm(String(n));
    return x.includes(c) || c.includes(x);
  });
}
// Search and return the first city-sized boundary that actually contains the point
// (skips the state/prefecture that ambiguous names surface).
function searchPick(q: string, lat: number, lng: number): Promise<GeoJSONGeom | null> {
  return fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&dedupe=0&limit=10&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : []))
    .then((arr) => {
      for (const r of Array.isArray(arr) ? arr : []) {
        const g = geomOf(r);
        if (g && geomExtentKm(g) <= MAX_CITY_KM && geomContains(lng, lat, g)) return g;
      }
      return null;
    })
    .catch(() => null);
}

export async function resolveCityBoundary(lat: number, lng: number, name: string, adm0: string): Promise<CityBoundary> {
  const r = await reverseFull(lat, lng, 10);
  const direct = geomOf(r);
  // Accept the reverse polygon only if it's city-sized AND named like the city —
  // at big-city centres zoom 10 can return a borough/ward whose polygon would
  // otherwise pass the size filter (Manhattan for New York, Chiyoda for Tokyo).
  if (direct && geomExtentKm(direct) <= MAX_CITY_KM && nameMatches(name, r)) return { geom: direct, source: "reverse" };
  const rejectedName = (direct && r && r.name) || ""; // the sub-city unit we refused

  if (r && r.address) {
    const a = r.address;
    const country = adm0 || a.country || "";
    const cands: [CityBoundary["source"], string][] = ([
      ["addr:municipality", a.municipality], ["addr:city", a.city], ["addr:town", a.town], ["addr:county", a.county],
    ] as [CityBoundary["source"], any][]).filter(([, v], i, arr) => v && v !== rejectedName && arr.findIndex(([, w]) => w === v) === i);
    for (const [source, nm] of cands) {
      const g = await searchPick(nm + (country ? ", " + country : ""), lat, lng);
      if (g) return { geom: g, source };
    }
  }

  const g = await searchPick(name + (adm0 ? ", " + adm0 : ""), lat, lng);
  return g ? { geom: g, source: "name-search" } : { geom: null, source: "none" };
}
