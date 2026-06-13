// Live integration test: hits the real OpenStreetMap (Nominatim) API and checks
// that notable cities resolve to a city-sized boundary that contains the point.
// This is the test that actually verifies real-world behaviour (mocked unit tests
// only check our branching logic). It's SKIPPED by default — opt in with:
//
//     pnpm test:live      (sets RUN_LIVE=1)
//
// Paced at ~1 request/second per Nominatim's usage policy, so it takes ~1 minute.
//
// Must run in the node environment: happy-dom simulates browser CORS and sends an
// OPTIONS preflight for every request (the custom User-Agent triggers it), which
// doubles the request rate and gets the IP 429-throttled by Nominatim.
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { resolveCityBoundary, geomContains, geomExtentKm, MAX_CITY_KM } from "./cityBoundary";

const LIVE = !!process.env.RUN_LIVE;

// minKm: assert a *lower* span bound too — catches resolving to a sub-city unit
// (e.g. Manhattan, 25 km, instead of City of New York, 68 km).
interface Case { name: string; lat: number; lng: number; adm0: string; hard?: boolean; minKm?: number }
const CITIES: Case[] = [
  { name: "Copenhagen", lat: 55.6761, lng: 12.5683, adm0: "Denmark" },
  { name: "Aarhus", lat: 56.1629, lng: 10.2039, adm0: "Denmark" },
  { name: "Sorø", lat: 55.4330, lng: 11.5667, adm0: "Denmark" },
  { name: "Hillerød", lat: 55.9279, lng: 12.3010, adm0: "Denmark" },
  { name: "Oslo", lat: 59.9139, lng: 10.7522, adm0: "Norway" },
  { name: "Stockholm", lat: 59.3293, lng: 18.0686, adm0: "Sweden" },
  { name: "Helsinki", lat: 60.1699, lng: 24.9384, adm0: "Finland" },
  { name: "Reykjavík", lat: 64.1466, lng: -21.9426, adm0: "Iceland" },
  { name: "New York", lat: 40.7128, lng: -74.0060, adm0: "United States", minKm: 40 },
  { name: "Los Angeles", lat: 34.0522, lng: -118.2437, adm0: "United States" },
  { name: "London", lat: 51.5074, lng: -0.1278, adm0: "United Kingdom" },
  { name: "Paris", lat: 48.8566, lng: 2.3522, adm0: "France" },
  { name: "Berlin", lat: 52.5200, lng: 13.4050, adm0: "Germany" },
  { name: "Madrid", lat: 40.4168, lng: -3.7038, adm0: "Spain" },
  { name: "Rome", lat: 41.9028, lng: 12.4964, adm0: "Italy" },
  { name: "Vienna", lat: 48.2082, lng: 16.3738, adm0: "Austria" },
  { name: "Amsterdam", lat: 52.3676, lng: 4.9041, adm0: "Netherlands" },
  { name: "Lisbon", lat: 38.7223, lng: -9.1393, adm0: "Portugal" },
  { name: "Dublin", lat: 53.3498, lng: -6.2603, adm0: "Ireland" },
  { name: "Sydney", lat: -33.8688, lng: 151.2093, adm0: "Australia" },
  { name: "Toronto", lat: 43.6532, lng: -79.3832, adm0: "Canada" },
  { name: "Mexico City", lat: 19.4326, lng: -99.1332, adm0: "Mexico" },
  { name: "São Paulo", lat: -23.5505, lng: -46.6333, adm0: "Brazil" },
  { name: "Cairo", lat: 30.0444, lng: 31.2357, adm0: "Egypt" },
  // Tokyo: deliberate policy — show the dot, no outline. The metropolis (東京都) is a
  // prefecture (span ~2500 km incl. the Izu/Ogasawara islands → rejected), its core is
  // 23 independent special wards with no single "city" boundary, and the special-wards
  // aggregate (区部) is not reachable via Nominatim (reverse skips it 区→都; name-search
  // returns only fulltext junk). So `none` is correct, not a gap. Logged, not asserted.
  { name: "Tokyo", lat: 35.6762, lng: 139.6503, adm0: "Japan", hard: true },
];

// Pace requests and add a polite User-Agent (browsers set one; Node doesn't).
let realFetch: typeof fetch;
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeAll(() => {
  realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: any, init: any = {}) => {
    // Nominatim throttles bursts with 429 even at ~1 req/s; back off and retry
    // instead of letting a throttled run masquerade as "no boundary found".
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, 1100 - (Date.now() - last));
      if (wait) await sleep(wait);
      last = Date.now();
      const res = await realFetch(url, { ...init, headers: { ...(init.headers || {}), "User-Agent": "Atlasaurus-outline-test/1.0" } });
      if (res.status !== 429 || attempt >= 3) return res;
      console.log(`  …429 throttled, backing off 30 s (retry ${attempt + 1}/3)`);
      await sleep(30_000);
    }
  });
});
afterAll(() => vi.unstubAllGlobals());

describe.skipIf(!LIVE)("Nominatim live city boundaries", () => {
  it.each(CITIES)("$name → a city-sized boundary containing the point", async (c) => {
    const res = await resolveCityBoundary(c.lat, c.lng, c.name, c.adm0);
    const span = res.geom ? Math.round(geomExtentKm(res.geom)) : null;
    // Surfaced in test output so a run doubles as a report.
    console.log(`${c.name.padEnd(14)} ${res.source.padEnd(18)} ${span ? span + " km" : "—"}`);
    if (c.hard) return; // known-ambiguous; logged only
    expect(res.geom, `${c.name}: no boundary returned`).not.toBeNull();
    expect(geomContains(c.lng, c.lat, res.geom!), `${c.name}: boundary does not contain the point`).toBe(true);
    expect(geomExtentKm(res.geom!), `${c.name}: boundary too large (${span} km)`).toBeLessThanOrEqual(MAX_CITY_KM);
    if (c.minKm) expect(geomExtentKm(res.geom!), `${c.name}: boundary too small (${span} km) — sub-city unit?`).toBeGreaterThanOrEqual(c.minKm);
  }, 240_000); // headroom for 429 backoff (up to 3 × 30 s per request)
});
