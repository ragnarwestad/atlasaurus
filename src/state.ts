// Shared types + mutable app state + the data collections every module reads.
// ES module imports are live but READ-ONLY bindings, so all mutable flags live
// as properties of the single exported `app` object (modules do `app.mode = …`).
import type L from "leaflet";
import { allPolygonParts, centerOf, type LatLng } from "./geo";
import type { Peak } from "./peaks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CountryEntry {
  name: string;
  layer: L.Polygon & { feature?: any };
  iso: string | null;
  iso2: string | null;
  continent?: string;
  isLandmass?: boolean; // Antarctica: a continent landmass, not a country
  labelTooltip?: L.Tooltip;
  labelPlaced?: boolean;
  labelArea?: number;    // |area| of the largest polygon part (deg²) — ranks names by size
  labelMinZoom?: number; // the zoom at/above which this country's name may show (from area rank)

  capitalMarker?: L.CircleMarker;
  capitalName?: string;
  flagMarker?: L.Marker;
}
export type CapitalMarker = L.CircleMarker & { _entry?: CountryEntry | null };
export interface Territory { name: string; adm0: string; lat: number; lng: number; }
export interface Subunit { name: string; lat: number; lng: number; }
// A populated place from the 10m cities dataset (see places.ts). Shared so the
// quiz can hold a target city (app.quizCity).
export interface CityRec { lat: number; lng: number; name: string; mz: number; cap: boolean; pop: number; iso: string; adm0: string; adm1: string; elev: number; }
export interface RestInfo { area?: number; currencies?: string; languages?: string; continent?: string; borders?: string[]; }

// Region grouping scheme for the Explore "Regions" tab. The quiz always uses
// standard continents.
export type GroupScheme = "continent" | "unRegion" | "subregion" | "wbRegion";
export type QuizType = "name" | "flag" | "capital" | "spot" | "continent" | "neighbour" | "peakname" | "peakcountry" | "cityname" | "citycountry";

export const CONTINENT_ORDER = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Antarctica", "Other"];

// ---------------------------------------------------------------------------
// Mutable state — one object so every module shares the same live values.
// ---------------------------------------------------------------------------
export const app = {
  // Explore selection / hover
  selectedLayer: null as L.Polygon | null,
  selectedContinent: null as string | null,
  hoveredLayer: null as L.Polygon | null,
  hoveredContinent: null as string | null,
  // Map option toggles
  showNames: false,
  showCapitals: false,
  showFlags: false,
  showPeaks: false,
  showRivers: false,
  showLakes: false,
  showCities: false,
  showHover: false, // off = Explore starts empty; hover only highlights the shape
  isolate: false,
  // Explore "guess mode": individual features clicked to reveal their real name
  // (the toggle reveals a whole type at once; a click reveals just the one).
  revealedPeaks: new Set<string>(),
  revealedRivers: new Set<string>(),
  revealedLakes: new Set<string>(),
  revealedCities: new Set<string>(),
  revealedCountries: new Set<string>(),
  // Region grouping (Regions tab) + per-region map tint hues
  groupScheme: "continent" as GroupScheme,
  regionHue: {} as Record<string, number>,
  // Quiz
  mode: "explore" as "explore" | "quiz",
  quizType: "name" as QuizType,
  quizPeak: null as Peak | null,
  quizCity: null as CityRec | null,       // cities quiz: the target city to locate
  quizStarted: false,
  quizNeighbourSet: new Set<CountryEntry>(),
  quizTarget: null as CountryEntry | null,
  quizGuess: null as CountryEntry | null,
  quizAnswered: false,
  quizCorrect: 0,
  quizTotal: 0,
  quizContCorrect: null as string | null, // continent quiz: correct continent (green)
  quizContWrong: null as string | null,   // continent quiz: wrongly guessed continent (red)
  nbSelected: new Set<CountryEntry>(),    // neighbour quiz: current picks
  nbMode: "map" as "map" | "search",
  locMode: "map" as "map" | "search",
  // Set on a country click so the map's background-click deselect doesn't fire in
  // the same event dispatch (robust even if stopPropagation is ineffective).
  suppressMapClick: false,
  // Sidebar
  activeTab: "countries" as "countries" | "continents",
  expandedContinent: null as string | null, // which continent's countries are listed
  sortBy: "name" as "name" | "population" | "area",
  // Fact panel
  currentInfoCode: null as string | null,
  currentInfoContinent: null as string | null,
  // mledoze/countries dataset (area/currency/languages/continent/borders), cached
  countryData: null as Record<string, RestInfo> | null,
};

// Cross-module callbacks, assigned by main.ts. Modules must NOT import the
// refreshAll coordinator directly (circular dep) — they call hooks.refreshAll().
export const hooks = {
  refreshAll: () => {},
  rebuildFeatureLists: () => {},
};

// ---------------------------------------------------------------------------
// Shared collections
// ---------------------------------------------------------------------------
export const countries: CountryEntry[] = [];
export const byIso: Record<string, CountryEntry> = {}; // ADM0_A3 → entry (for neighbour lookups)
export const capitalMarkers: CapitalMarker[] = [];
export const subunitsByIso: Record<string, Subunit[]> = {};
export const territoriesBySov: Record<string, Territory[]> = {};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------
export function fmtInt(n: number): string { return Math.round(n).toLocaleString("en-US"); }

// Explore guess-mode label: the real name once revealed, else an anonymous
// "<Type> ?" placeholder the user can guess and click to confirm.
export function featureLabel(typeWord: string, name: string, revealed: boolean): string {
  return revealed ? name : typeWord + " ?";
}

export function fetchJson(urls: string[]): Promise<any> {
  let i = 0;
  const attempt = (): Promise<any> => {
    if (i >= urls.length) return Promise.reject(new Error("All sources failed"));
    return fetch(urls[i])
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .catch(() => { i++; return attempt(); });
  };
  return attempt();
}

// Real countries exclude the Antarctica landmass (a continent, not a country).
export function realCountries(): CountryEntry[] { return countries.filter((c) => !c.isLandmass); }

export function entryForLayer(layer: L.Layer | null): CountryEntry | null {
  return layer ? (countries.find((e) => e.layer === layer) || null) : null;
}

export function popOf(e: CountryEntry): number {
  const p = ((e.layer as any).feature && (e.layer as any).feature.properties) || {};
  return p.POP_EST || 0;
}
export function areaOf(e: CountryEntry): number {
  return (app.countryData && e.iso && app.countryData[e.iso] && app.countryData[e.iso].area) || 0;
}

// The zoom at/above which a populated place should appear: prefer Natural
// Earth's min_zoom, fall back to scalerank, then to a population-based guess.
// (Lives here rather than places.ts so it stays import-pure and unit-testable.)
export function placeMinZoom(p: any): number {
  if (p.min_zoom != null) return +p.min_zoom;
  if (p.scalerank != null) return +p.scalerank;
  const pop = +(p.pop_max || 0);
  return pop > 5e6 ? 1 : pop > 1e6 ? 3 : pop > 2e5 ? 5 : 7;
}

export function layerCenter(entry: CountryEntry): LatLng | null {
  try {
    const parts = allPolygonParts((entry.layer as any).feature && (entry.layer as any).feature.geometry);
    if (parts.length) return centerOf(parts[0].rings);
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// mledoze/countries dataset — a static file on jsDelivr (the data REST Countries
// is built from), keyed by ISO-3. Fetched once on first use, then cached.
// ---------------------------------------------------------------------------
const COUNTRY_DATA_URLS = [
  "https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json",
  "https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
];
let countryDataPromise: Promise<Record<string, RestInfo>> | null = null;

export function loadCountryData(): Promise<Record<string, RestInfo>> {
  if (countryDataPromise) return countryDataPromise;
  countryDataPromise = fetchJson(COUNTRY_DATA_URLS).then((arr: any[]) => {
    const byCode: Record<string, RestInfo> = {};
    (arr || []).forEach((c) => {
      if (!c || !c.cca3) return;
      const currencies = c.currencies
        ? Object.keys(c.currencies).map((cc) => {
            const i = c.currencies[cc];
            return i.name + " (" + cc + (i.symbol ? ", " + i.symbol : "") + ")";
          }).join(", ")
        : undefined;
      const languages = c.languages ? Object.values(c.languages).join(", ") : undefined;
      const continent = Array.isArray(c.continents) && c.continents.length ? c.continents[0] : c.region;
      byCode[c.cca3] = { area: c.area, currencies, languages, continent, borders: Array.isArray(c.borders) ? c.borders : [] };
    });
    app.countryData = byCode;
    return byCode;
  });
  return countryDataPromise;
}
