import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCityBoundary, geomContains, geomExtentKm, MAX_CITY_KM } from "./cityBoundary";

// Axis-aligned square polygon centred on (cx,cy) with the given half-width in degrees.
const rect = (cx: number, cy: number, half: number) => ({
  type: "Polygon",
  coordinates: [[[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]],
});
const point = (cx: number, cy: number) => ({ type: "Point", coordinates: [cx, cy] });
const ok = (data: any) => ({ ok: true, json: () => Promise.resolve(data) });

// Each test installs a handler that maps a request URL → the payload to return.
let handler: (url: string) => any;
const qOf = (url: string) => new URL(url).searchParams.get("q") || "";
const isReverse = (url: string) => url.includes("/reverse?");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(ok(handler(String(url))))));
});
afterEach(() => vi.unstubAllGlobals());

describe("geomExtentKm", () => {
  it("measures a ~22 km box near the equator", () => {
    // 0.1° half-width → 0.2° box ≈ 22 km/side → diagonal ≈ 31 km.
    expect(geomExtentKm(rect(0, 0, 0.1))).toBeGreaterThan(28);
    expect(geomExtentKm(rect(0, 0, 0.1))).toBeLessThan(34);
  });
  it("shrinks longitudinal span away from the equator", () => {
    expect(geomExtentKm(rect(0, 60, 0.5))).toBeLessThan(geomExtentKm(rect(0, 0, 0.5)));
  });
});

describe("geomContains", () => {
  it("is true inside the polygon, false outside", () => {
    expect(geomContains(0, 0, rect(0, 0, 1))).toBe(true);
    expect(geomContains(5, 5, rect(0, 0, 1))).toBe(false);
  });
  it("excludes points inside a hole", () => {
    const withHole = {
      type: "Polygon",
      coordinates: [
        [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],   // outer
        [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]], // hole
      ],
    };
    expect(geomContains(1.5, 1.5, withHole)).toBe(true);  // in outer, not hole
    expect(geomContains(0, 0, withHole)).toBe(false);     // in the hole
  });
});

describe("resolveCityBoundary", () => {
  it("uses the reverse polygon directly for a normal town (Sorø)", async () => {
    const poly = rect(11.567, 55.433, 0.08); // small kommune around the point
    handler = (url) => (isReverse(url) ? { geojson: poly, name: "Sorø Kommune", address: { municipality: "Sorø Kommune" } } : []);
    const res = await resolveCityBoundary(55.433, 11.567, "Sorø", "Denmark");
    expect(res.source).toBe("reverse");
    expect(res.geom).toEqual(poly);
  });

  it("falls back to the municipality search when reverse returns the city point (Copenhagen)", async () => {
    const kommune = rect(12.56, 55.68, 0.12);
    handler = (url) => {
      if (isReverse(url)) return { geojson: point(12.56, 55.68), address: { municipality: "Københavns Kommune", city: "København", country: "Denmark" } };
      return qOf(url).startsWith("Københavns Kommune") ? [{ geojson: kommune }] : [];
    };
    const res = await resolveCityBoundary(55.68, 12.56, "København", "Denmark");
    expect(res.source).toBe("addr:municipality");
    expect(res.geom).toEqual(kommune);
  });

  it("rejects the oversized state and picks the city that contains the point (New York)", async () => {
    const state = rect(-75, 43, 4);       // ~600 km → rejected by MAX_CITY_KM
    const city = rect(-74, 40.7, 0.25);   // ~55 km, contains the NYC point
    handler = (url) => {
      if (isReverse(url)) return { geojson: point(-74, 40.7), address: { city: "New York", country: "United States" } };
      return qOf(url).startsWith("New York") ? [{ geojson: state }, { geojson: city }] : [];
    };
    const res = await resolveCityBoundary(40.7, -74, "New York", "United States");
    expect(res.source).toBe("addr:city");
    expect(res.geom).toEqual(city);
    expect(geomExtentKm(res.geom!)).toBeLessThanOrEqual(MAX_CITY_KM);
    expect(geomContains(-74, 40.7, res.geom!)).toBe(true);
  });

  it("returns none when only an oversized match exists (Tokyo-style prefecture)", async () => {
    const prefecture = rect(139.7, 35.7, 3); // huge, contains the point but too big
    handler = (url) => {
      if (isReverse(url)) return { geojson: point(139.7, 35.69), address: { city: "Tokyo", country: "Japan" } };
      return [{ geojson: prefecture }];
    };
    const res = await resolveCityBoundary(35.69, 139.7, "Tokyo", "Japan");
    expect(res.geom).toBeNull();
    expect(res.source).toBe("none");
  });

  // Real shape observed live (2026-06-12): at NYC's centre, reverse?zoom=10 returns
  // the Manhattan polygon (25 km — passes the size filter) with address.city still
  // naming the real city. The name mismatch must push us to the address search.
  it("rejects a city-sized borough from reverse and searches the address city (New York → Manhattan)", async () => {
    const manhattan = rect(-73.97, 40.78, 0.11); // ~25 km, contains the point
    const city = rect(-74, 40.7, 0.3);           // ~68 km City of New York
    handler = (url) => {
      if (isReverse(url)) return { geojson: manhattan, name: "Manhattan", address: { city: "New York", county: "New York County", state: "New York" } };
      return qOf(url).startsWith("New York,") ? [{ geojson: city, name: "New York" }] : [];
    };
    const res = await resolveCityBoundary(40.72, -73.99, "New York", "United States of America");
    expect(res.source).toBe("addr:city");
    expect(res.geom).toEqual(city);
  });

  // Real shape observed live (2026-06-12): at Tokyo's centre, reverse?zoom=10
  // returns the tiny Chiyoda ward polygon, and address.city is that same ward —
  // so the candidate must be skipped (searching it would just re-pick the ward),
  // leaving the name search, where the metropolis is rejected as oversized.
  it("skips the rejected ward in the address candidates (Tokyo → Chiyoda)", async () => {
    const chiyoda = rect(139.75, 35.69, 0.025); // ~6 km ward around the point
    const metropolis = rect(139.7, 35.7, 3);    // huge; rejected by MAX_CITY_KM
    handler = (url) => {
      if (isReverse(url)) return { geojson: chiyoda, name: "千代田区", address: { city: "千代田区" } };
      if (qOf(url).startsWith("千代田区")) return [{ geojson: chiyoda, name: "千代田区" }]; // would wrongly re-pick the ward
      return [{ geojson: metropolis, name: "東京都" }];
    };
    const res = await resolveCityBoundary(35.687, 139.749, "Tokyo", "Japan");
    expect(res.geom).toBeNull();
    expect(res.source).toBe("none");
  });

  it("rejects a search hit that does not contain the city point", async () => {
    const elsewhere = rect(0, 0, 0.2); // city-sized but nowhere near the point
    handler = (url) => {
      if (isReverse(url)) return { geojson: point(10, 50), address: { city: "Somewhere", country: "X" } };
      return [{ geojson: elsewhere }];
    };
    const res = await resolveCityBoundary(50, 10, "Somewhere", "X");
    expect(res.geom).toBeNull();
  });

  it("returns none when nothing matches at all", async () => {
    handler = () => [];
    const res = await resolveCityBoundary(0, 0, "Nowhere", "");
    expect(res).toEqual({ geom: null, source: "none" });
  });
});
