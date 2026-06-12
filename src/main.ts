import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import {
  BORDER_URLS, CAPITAL_URLS, SUBUNIT_URLS, RIVER_URLS, LAKE_URLS,
  baseStyle, hoverStyle, selectedStyle, relatedStyle, continentStyle, hiddenStyle,
  quizCorrectStyle, quizWrongStyle,
  CONNECTOR_MIN_AREA, CONNECTOR_MAX_LINES, SUBUNIT_MATCH_MAX_D2,
} from "./config";
import { allPolygonParts, centerOf, type LatLng } from "./geo";
import { wikiUrl, cityWikiUrl, escapeHtml } from "./wiki";
import { PEAKS, type Peak } from "./peaks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CountryEntry {
  name: string;
  layer: L.Polygon & { feature?: any };
  iso: string | null;
  iso2: string | null;
  continent?: string;
  isLandmass?: boolean; // Antarctica: a continent landmass, not a country
  labelTooltip?: L.Tooltip;
  labelPlaced?: boolean;
  capitalMarker?: L.CircleMarker;
  capitalName?: string;
  flagMarker?: L.Marker;
}
type CapitalMarker = L.CircleMarker & { _entry?: CountryEntry | null };
interface Territory { name: string; adm0: string; lat: number; lng: number; }
interface Subunit { name: string; lat: number; lng: number; }

// ---------------------------------------------------------------------------
// Map + layers
// ---------------------------------------------------------------------------
const statusEl = document.getElementById("status");
const setStatus = (msg: string) => { if (statusEl) statusEl.textContent = msg; };
const hideStatus = () => { if (statusEl) statusEl.remove(); };

const map = L.map("map", { worldCopyJump: true, minZoom: 2, maxZoom: 8 }).setView([25, 10], 2);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a> · Borders &amp; capitals: Natural Earth',
  subdomains: "abcd",
  maxZoom: 8,
}).addTo(map);

const capitalLayer = L.layerGroup().addTo(map);    // capital dots + name labels
const connectorLayer = L.layerGroup().addTo(map);  // satellite/sovereignty lines
const flagLayer = L.layerGroup().addTo(map);       // flag images
const peakLayer = L.layerGroup().addTo(map);       // mountain-peak markers
const riverLayer = L.layerGroup().addTo(map);      // major river centerlines
const lakeLayer = L.layerGroup().addTo(map);       // major lakes
const quizLayer = L.layerGroup().addTo(map);       // quiz: guess→answer line + dots
const quizContLayer = L.layerGroup().addTo(map);   // quiz: continent name labels
const regionLabelLayer = L.layerGroup().addTo(map); // explore: region name labels (Regions tab)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const countries: CountryEntry[] = [];
const byIso: Record<string, CountryEntry> = {}; // ADM0_A3 → entry (for neighbour lookups)
const capitalMarkers: CapitalMarker[] = [];
const subunitsByIso: Record<string, Subunit[]> = {};
const territoriesBySov: Record<string, Territory[]> = {};

let selectedLayer: L.Polygon | null = null;
let selectedContinent: string | null = null;
let hoveredLayer: L.Polygon | null = null;
let hoveredContinent: string | null = null;
let showNames = false;
let showCapitals = false;
let showFlags = false;
let showPeaks = false;
let showRivers = false;
let showLakes = false;
let isolate = false;

// Region grouping scheme for the Explore "Regions" tab. The quiz always uses
// standard continents. Non-continent schemes read straight from the Natural
// Earth feature properties we already load (REGION_UN / SUBREGION / REGION_WB).
type GroupScheme = "continent" | "unRegion" | "subregion" | "wbRegion";
let groupScheme: GroupScheme = "continent";
const SCHEME_PROP: Record<Exclude<GroupScheme, "continent">, string> = {
  unRegion: "REGION_UN", subregion: "SUBREGION", wbRegion: "REGION_WB",
};
const SCHEME_LABEL: Record<GroupScheme, string> = {
  continent: "Continent", unRegion: "UN region", subregion: "UN subregion", wbRegion: "World Bank region",
};
function groupOf(e: CountryEntry): string {
  if (groupScheme === "continent") return e.continent || "Other";
  const p = (e.layer.feature && e.layer.feature.properties) || {};
  const v = p[SCHEME_PROP[groupScheme]];
  return (v != null && String(v).trim()) ? String(v).trim() : "Other";
}
// Distinct hue per region for the Regions-tab map tint (spread around the wheel).
let regionHue: Record<string, number> = {};
function rebuildRegionColors(): void {
  const groups = Array.from(new Set(realCountries().map(groupOf))).filter((g) => g !== "Other").sort();
  regionHue = {};
  const n = groups.length || 1;
  groups.forEach((g, i) => { regionHue[g] = Math.round((360 * i) / n); });
}

// Quiz mode
let mode: "explore" | "quiz" = "explore";
type QuizType = "name" | "flag" | "capital" | "spot" | "continent" | "neighbour" | "peakname" | "peakcountry";
let quizType: QuizType = "name";
let quizPeak: Peak | null = null;
let quizStarted = false;
let quizNeighbourSet = new Set<CountryEntry>();
let quizTarget: CountryEntry | null = null;
let quizGuess: CountryEntry | null = null;
let quizAnswered = false;
let quizCorrect = 0;
let quizTotal = 0;
let quizContCorrect: string | null = null; // continent quiz: correct continent (green)
let quizContWrong: string | null = null;   // continent quiz: wrongly guessed continent (red)
// Set on a country click so the map's background-click deselect doesn't fire in
// the same event dispatch (robust even if stopPropagation is ineffective).
let suppressMapClick = false;

// ---------------------------------------------------------------------------
// Visibility / styling helpers
// ---------------------------------------------------------------------------
function sovOf(layer: any): string | null {
  const p = (layer && layer.feature && layer.feature.properties) || {};
  return p.SOV_A3 || p.sov_a3 || null;
}
/** Same sovereign state (e.g. Denmark ↔ Greenland/Faroe), different unit. */
function sameRealm(e: CountryEntry): boolean {
  if (!selectedLayer || e.layer === selectedLayer) return false;
  const s = sovOf(selectedLayer), x = sovOf(e.layer);
  return !!s && s === x;
}
// Reveal = country selected (or a realm sibling). On-map labels/capitals/flags
// are shown for these (and via the toggles) — NOT on hover. Hover info goes to a
// separate off-map panel (see showHoverInfo) so it can't fight the polygon's
// hover/click and cause flicker. On-map labels stay interactive (clickable).
function isRevealed(e: CountryEntry): boolean {
  return e.layer === selectedLayer || sameRealm(e);
}
function countryVisible(e: CountryEntry): boolean {
  if (mode === "quiz") return true; // everything visible/clickable in the quiz
  // A selected continent takes precedence: keep showing all its members (the
  // selected country, if any, is one of them).
  if (isolate && selectedContinent) return groupOf(e) === selectedContinent;
  if (isolate && selectedLayer) return e.layer === selectedLayer || sameRealm(e);
  return true;
}

// Scope of the "Show names/capitals/flags" toggles:
//  - Countries tab: global (all countries).
//  - Continents tab: only the selected continent's members (nothing if none).
function inToggleScope(e: CountryEntry): boolean {
  if (activeTab === "continents") return selectedContinent != null && groupOf(e) === selectedContinent;
  return true;
}

function refreshCountryLabels(): void {
  countries.forEach((e) => {
    if (!e.labelTooltip) return;
    const el = e.labelTooltip.getElement();
    if (!el) return;
    if (mode === "quiz") { el.style.display = "none"; return; } // clean map for the quiz
    el.style.display = countryVisible(e) && ((showNames && inToggleScope(e)) || isRevealed(e)) ? "" : "none";
  });
}

function refreshCapitals(): void {
  if (mode === "quiz") { capitalMarkers.forEach((m) => { if (capitalLayer.hasLayer(m)) capitalLayer.removeLayer(m); }); return; }
  capitalMarkers.forEach((m) => {
    const e = m._entry;
    const cv = e ? countryVisible(e) : !(isolate && selectedLayer);
    const byToggle = e ? (showCapitals && inToggleScope(e)) : (showCapitals && activeTab === "countries");
    const visible = cv && (byToggle || (e ? isRevealed(e) : false));
    const has = capitalLayer.hasLayer(m);
    if (visible && !has) capitalLayer.addLayer(m);
    else if (!visible && has) capitalLayer.removeLayer(m);
  });
}

function refreshFlags(): void {
  if (mode === "quiz") { countries.forEach((e) => { if (e.flagMarker && flagLayer.hasLayer(e.flagMarker)) flagLayer.removeLayer(e.flagMarker); }); return; }
  countries.forEach((e) => {
    if (!e.flagMarker) return;
    const visible = countryVisible(e) && ((showFlags && inToggleScope(e)) || isRevealed(e));
    const has = flagLayer.hasLayer(e.flagMarker);
    if (visible && !has) flagLayer.addLayer(e.flagMarker);
    else if (!visible && has) flagLayer.removeLayer(e.flagMarker);
  });
}

// --- Hover info panel that floats next to the cursor (flag + name + capital) ---
const hoverInfoEl = document.getElementById("hoverinfo")!;
let lastMouseX = 0, lastMouseY = 0;

function positionHoverInfo(x: number, y: number): void {
  const pad = 12;
  const r = hoverInfoEl.getBoundingClientRect();
  let left = x + 16;            // default: to the lower-right of the cursor
  let top = y + 18;
  if (left + r.width + pad > window.innerWidth) left = x - r.width - 16;   // flip left near right edge
  if (top + r.height + pad > window.innerHeight) top = y - r.height - 18;  // flip up near bottom edge
  hoverInfoEl.style.left = Math.max(pad, left) + "px";
  hoverInfoEl.style.top = Math.max(pad, top) + "px";
}

function showHoverInfo(e: CountryEntry): void {
  const flag = e.iso2 ? '<img src="https://flagcdn.com/32x24/' + e.iso2 + '.png" alt="">' : "";
  const cap = e.capitalName ? '<span class="hi-cap">· ' + escapeHtml(e.capitalName) + "</span>" : "";
  hoverInfoEl.innerHTML = flag + '<span class="hi-name">' + escapeHtml(e.name) + "</span> " + cap;
  hoverInfoEl.hidden = false;
  positionHoverInfo(lastMouseX, lastMouseY);
}
function hideHoverInfo(): void {
  hoverInfoEl.hidden = true;
}

// --- Selected-country fact panel (population/GDP/region from Natural Earth,
//     area/currency/languages from REST Countries, fetched + cached on select) ---
interface RestInfo { area?: number; currencies?: string; languages?: string; continent?: string; borders?: string[]; }
const countryInfoEl = document.getElementById("countryinfo")!;
let currentInfoCode: string | null = null;
let currentInfoContinent: string | null = null;

// Area / currency / languages come from the mledoze/countries dataset — a static
// file on jsDelivr (the data REST Countries is built from), keyed by ISO-3.
// Fetched once on the first selection, then cached for the session.
const COUNTRY_DATA_URLS = [
  "https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json",
  "https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
];
let countryData: Record<string, RestInfo> | null = null;
let countryDataPromise: Promise<Record<string, RestInfo>> | null = null;

function loadCountryData(): Promise<Record<string, RestInfo>> {
  if (countryDataPromise) return countryDataPromise;
  countryDataPromise = fetchJson(COUNTRY_DATA_URLS).then((arr: any[]) => {
    const map: Record<string, RestInfo> = {};
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
      map[c.cca3] = { area: c.area, currencies, languages, continent, borders: Array.isArray(c.borders) ? c.borders : [] };
    });
    countryData = map;
    return map;
  });
  return countryDataPromise;
}

function fmtInt(n: number): string { return Math.round(n).toLocaleString("en-US"); }
function entryForLayer(layer: L.Layer | null): CountryEntry | null {
  return layer ? (countries.find((e) => e.layer === layer) || null) : null;
}

function buildInfoHTML(props: any, entry: CountryEntry | null, extra: RestInfo | null, territories: string[]): string {
  const name = props.FORMAL_EN || props.NAME_LONG || props.ADMIN || (entry && entry.name) || "Unknown";
  const longName = props.NAME_LONG && props.NAME_LONG !== name ? props.NAME_LONG : "";
  const flag = entry && entry.iso2 ? '<img src="https://flagcdn.com/40x30/' + entry.iso2 + '.png" alt="">' : "";
  const rows: [string, string][] = [];
  if (entry && entry.capitalName) {
    rows.push(["Capital", '<a href="' + cityWikiUrl(entry.capitalName) + '" target="_blank" rel="noopener">' +
      escapeHtml(entry.capitalName) + "</a>"]);
  }
  if (props.POP_EST) rows.push(["Population", fmtInt(props.POP_EST) + (props.POP_YEAR ? " (" + props.POP_YEAR + ")" : "")]);
  if (extra && extra.area) rows.push(["Area", fmtInt(extra.area) + " km²"]);
  if (props.GDP_MD) rows.push(["GDP", "$" + fmtInt(props.GDP_MD) + " M" + (props.GDP_YEAR ? " (" + props.GDP_YEAR + ")" : "")]);
  if (extra && extra.currencies) rows.push(["Currency", escapeHtml(extra.currencies)]);
  if (extra && extra.languages) rows.push(["Languages", escapeHtml(extra.languages)]);
  const region = [props.CONTINENT, props.SUBREGION].filter(Boolean).join(" · ");
  if (region) rows.push(["Region", escapeHtml(region)]);
  if (props.INCOME_GRP) rows.push(["Income group", escapeHtml(String(props.INCOME_GRP).replace(/^\d+\.\s*/, ""))]);
  const dl = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");

  let terrBlock = "";
  if (territories.length) {
    const links = territories
      .map((n) => '<a href="' + wikiUrl(n) + '" target="_blank" rel="noopener">' + escapeHtml(n) + "</a>")
      .join(", ");
    terrBlock = '<div class="ci-terr"><div class="ci-terr-h">Territories (' + territories.length +
      ')</div><div class="ci-terr-list">' + links + "</div></div>";
  }

  const titleLink = '<a href="' + wikiUrl(entry ? entry.name : name) + '" target="_blank" rel="noopener">' +
    escapeHtml(name) + ' <span class="ext">↗</span></a>';
  return (
    '<div class="ci-head">' + flag +
      '<div><div class="ci-title">' + titleLink + "</div>" +
        (longName ? '<div class="ci-sub">' + escapeHtml(longName) + "</div>" : "") +
      "</div>" +
      '<button class="ci-toggle" title="Collapse / expand" aria-label="Collapse / expand"><span class="ci-caret"></span></button>' +
      '<button class="ci-close" title="Close" aria-label="Close">×</button>' +
    "</div>" +
    "<dl>" + dl + "</dl>" + terrBlock
  );
}

function renderInfo(props: any, entry: CountryEntry | null, extra: RestInfo | null, territories: string[]): void {
  countryInfoEl.innerHTML = buildInfoHTML(props, entry, extra, territories);
  countryInfoEl.hidden = false;
  const close = countryInfoEl.querySelector(".ci-close");
  if (close) close.addEventListener("click", deselect);
  const toggle = countryInfoEl.querySelector(".ci-toggle");
  if (toggle) toggle.addEventListener("click", () => countryInfoEl.classList.toggle("collapsed"));
  const head = countryInfoEl.querySelector(".ci-head");
  if (head) makeDraggable(countryInfoEl, head as HTMLElement,
    () => countryInfoEl.classList.toggle("collapsed"));
}

// Drag a panel by a handle element, with an optional click handler (fired only
// on a clean click — no drag — that didn't land on a link/button). Links and
// buttons inside the handle still work; dragging switches to top/left so the
// panel stays where it's dropped, clamped to the viewport.
function makeDraggable(panel: HTMLElement, handle: HTMLElement, onClick?: () => void): void {
  handle.addEventListener("mousedown", (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    let moved = false;
    const onMove = (m: MouseEvent) => {
      if (!moved) { moved = true; panel.style.bottom = "auto"; }
      const nx = Math.max(0, Math.min(window.innerWidth - rect.width, m.clientX - offX));
      const ny = Math.max(0, Math.min(window.innerHeight - 36, m.clientY - offY));
      panel.style.left = nx + "px";
      panel.style.top = ny + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!moved && onClick) onClick();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// Bottom panel shows the selected COUNTRY, or the selected CONTINENT, or nothing.
function updateInfoPanel(): void {
  if (mode === "quiz") { countryInfoEl.hidden = true; return; }
  if (selectedLayer) { renderCountryInfo(); return; }
  if (selectedContinent) { renderContinentInfo(selectedContinent); return; }
  countryInfoEl.hidden = true;
  currentInfoCode = null;
  currentInfoContinent = null;
}

function isNarrow(): boolean { return window.matchMedia("(max-width: 700px)").matches; }

// On a fresh selection, default the bottom sheet to collapsed on small screens
// (so it doesn't cover the map) and drop any leftover drag offset.
function defaultPanelLayout(isNew: boolean): void {
  if (!isNew) return;
  if (isNarrow()) {
    countryInfoEl.classList.add("collapsed");
    countryInfoEl.style.left = "";
    countryInfoEl.style.top = "";
    countryInfoEl.style.bottom = "";
  } else {
    countryInfoEl.classList.remove("collapsed");
  }
}

function renderCountryInfo(): void {
  currentInfoContinent = null;
  const props = ((selectedLayer as any).feature && (selectedLayer as any).feature.properties) || {};
  const entry = entryForLayer(selectedLayer);
  const code: string | null = props.ADM0_A3 || props.adm0_a3 || null;
  const isNew = code !== currentInfoCode;
  currentInfoCode = code;
  const conn = selectedLayer ? computeConnectors(selectedLayer) : null;
  const territories = conn ? conn.items.map((i) => i.name).sort((a, b) => a.localeCompare(b)) : [];
  renderInfo(props, entry, (countryData && code) ? countryData[code] || null : null, territories);
  defaultPanelLayout(isNew);

  // Lazy-load area/currency/languages the first time, then re-render.
  if (!countryData) {
    loadCountryData().then((map) => {
      if (currentInfoCode === code && selectedLayer) renderInfo(props, entry, code ? map[code] || null : null, territories);
    }).catch(() => { /* extra fields optional */ });
  }
}

function renderContinentInfo(name: string): void {
  currentInfoCode = null;
  if (name !== currentInfoContinent && isNarrow()) {
    // Continent panel has no collapse toggle — just clear any drag offset so it
    // sits as a proper full-width bottom sheet (and isn't a leftover strip).
    countryInfoEl.classList.remove("collapsed");
    countryInfoEl.style.left = "";
    countryInfoEl.style.top = "";
    countryInfoEl.style.bottom = "";
  }
  currentInfoContinent = name;
  const members = countries.filter((e) => groupOf(e) === name && !e.isLandmass);
  let pop = 0, gdp = 0, area = 0, topName = "", topPop = -1;
  members.forEach((e) => {
    const p = ((e.layer as any).feature && (e.layer as any).feature.properties) || {};
    if (p.POP_EST) pop += p.POP_EST;
    if (p.GDP_MD) gdp += p.GDP_MD;
    if (p.POP_EST > topPop) { topPop = p.POP_EST; topName = e.name; }
    if (countryData && e.iso && countryData[e.iso] && countryData[e.iso].area) area += countryData[e.iso].area as number;
  });
  const rows: [string, string][] = [["Countries", String(members.length)]];
  if (pop) rows.push(["Population", fmtInt(pop)]);
  if (countryData && area) rows.push(["Area", fmtInt(area) + " km²"]);
  if (gdp) rows.push(["GDP", "$" + fmtInt(gdp) + " M"]);
  if (topName) rows.push(["Most populous", escapeHtml(topName)]);
  const dl = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  // Link geographic names to Wikipedia; World Bank names ("Latin America &
  // Caribbean" etc.) aren't article titles, so show them as plain text.
  const linkable = name !== "Other" && groupScheme !== "wbRegion";
  const titleLink = linkable
    ? '<a href="' + wikiUrl(name) + '" target="_blank" rel="noopener">' + escapeHtml(name) + ' <span class="ext">↗</span></a>'
    : escapeHtml(name);
  countryInfoEl.innerHTML =
    '<div class="ci-head"><div><div class="ci-title">' + titleLink + "</div>" +
    '<div class="ci-sub">' + SCHEME_LABEL[groupScheme] + "</div></div>" +
    '<button class="ci-close" title="Close" aria-label="Close">×</button></div>' +
    "<dl>" + dl + "</dl>";
  countryInfoEl.hidden = false;
  const close = countryInfoEl.querySelector(".ci-close");
  if (close) close.addEventListener("click", deselect);

  // Area needs the country dataset; lazy-load then re-render if still showing.
  if (!countryData) {
    loadCountryData().then(() => {
      if (currentInfoContinent === name && selectedContinent === name) renderContinentInfo(name);
    }).catch(() => { /* area optional */ });
  }
}

function styleForLayer(e: CountryEntry): L.PathOptions | null {
  if (mode === "quiz") {
    if (quizAnswered) {
      if (quizType === "continent") {
        const cont = e.continent || "Other";
        if (quizContCorrect && cont === quizContCorrect) return quizCorrectStyle; // correct continent (green)
        if (quizContWrong && cont === quizContWrong) return quizWrongStyle;       // guessed continent (red)
        return baseStyle; // answered → no per-country hover in continent quiz
      } else if (quizType === "neighbour") {
        if (e === quizTarget) return selectedStyle;          // the anchor country (orange)
        if (quizNeighbourSet.has(e)) return quizCorrectStyle; // its neighbours (green)
        if (nbSelected.has(e)) return quizWrongStyle;        // a wrong pick (red)
        return baseStyle; // answered → no per-country hover
      } else if (quizType === "peakcountry") {
        if (quizPeak && e.iso && quizPeak.iso.includes(e.iso)) return quizCorrectStyle; // the peak's country (green)
        if (quizGuess && e === quizGuess) return quizWrongStyle;                          // wrong pick (red)
        return baseStyle;
      } else if (quizType === "peakname") {
        return baseStyle; // answer shown on the marker, not the countries
      } else {
        if (e === quizTarget) return quizCorrectStyle;                       // the right answer (green)
        if (quizGuess && e === quizGuess && quizGuess !== quizTarget) return quizWrongStyle; // wrong guess (red)
      }
    } else if (quizType === "continent") {
      // Tint each continent so the clickable regions are obvious; hovering any
      // country deepens the shade of its WHOLE continent.
      const st = CONTINENT_QUIZ_STYLES[e.continent || "Other"];
      if (st) {
        const hot = hoveredContinent && (e.continent || "Other") === hoveredContinent;
        return hot ? { ...st, fillOpacity: 0.82, weight: 1.5 } : st;
      }
    } else if (quizType === "neighbour" && nbSelected.has(e)) {
      return relatedStyle; // your current picks (before checking)
    } else if (quizType === "spot" && e === quizTarget) {
      return selectedStyle; // the country to name (orange highlight + pin)
    }
    if (e.layer === hoveredLayer) return hoverStyle;
    return baseStyle;
  }
  // Hidden in isolate mode: continent context wins (hide non-members); else the
  // single-country context (hide everything but it and its realm siblings).
  if (isolate && selectedContinent) {
    if (groupOf(e) !== selectedContinent) return null;
  } else if (isolate && selectedLayer && e.layer !== selectedLayer && !sameRealm(e)) {
    return null;
  }
  if (e.layer === selectedLayer) return selectedStyle;                                   // selected country (orange)
  // Regions tab: tint every country by its region (distinct hue), like the
  // continent quiz. The selected region and the hovered region get a deeper fill.
  if (activeTab === "continents") {
    const hue = regionHue[groupOf(e)];
    if (hue != null) {
      const sel = selectedContinent === groupOf(e);
      const hot = !sel && hoveredContinent === groupOf(e);
      return {
        color: "hsl(" + hue + ", 55%, 38%)", weight: sel ? 1.8 : hot ? 1.3 : 1, opacity: 1,
        fillColor: "hsl(" + hue + ", 60%, 62%)", fillOpacity: sel ? 0.72 : hot ? 0.6 : 0.45,
      };
    }
  }
  if (selectedContinent && groupOf(e) === selectedContinent) return continentStyle; // region member (green)
  if (sameRealm(e)) return relatedStyle;
  if (e.layer === hoveredLayer) return hoverStyle;
  return baseStyle;
}

function refreshPolygons(): void {
  countries.forEach((e) => {
    const st = styleForLayer(e);
    const el = (e.layer as any).getElement ? (e.layer as any).getElement() : null;
    if (st === null) {
      e.layer.setStyle(hiddenStyle);
      // Keep hidden countries clickable ("all" catches clicks even with 0
      // opacity) so you can switch directly to another country in isolate mode.
      if (el) el.style.pointerEvents = "all";
    } else {
      e.layer.setStyle(st);
      if (el) el.style.pointerEvents = "";
      // NOTE: do NOT bringToFront here — runs on every hover refresh and would
      // re-append the path mid-interaction, swallowing clicks.
    }
  });
}

// ---------------------------------------------------------------------------
// Connector lines (satellites + sovereignty links)
// ---------------------------------------------------------------------------
function nearestSubunitName(iso: string | null, latlng: LatLng): string | null {
  const subs = (iso && subunitsByIso[iso]) || [];
  let best: Subunit | undefined;
  let bestD = SUBUNIT_MATCH_MAX_D2;
  for (const s of subs) {
    const dlat = s.lat - latlng[0], dlng = s.lng - latlng[1];
    const d = dlat * dlat + dlng * dlng;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best ? best.name : null;
}

interface Connector { tip: LatLng; name: string; }

// Compute a country's associated territories — each with a UNIQUE name, so
// every connector carries a label (no unnamed/duplicate lines). Two sources:
//  (a) named detached parts of the same feature (Alaska, Hawaii, Réunion …);
//  (b) separate features under the same sovereign (Greenland, Falklands …).
function computeConnectors(layer: L.Polygon): { home: LatLng; items: Connector[] } | null {
  const feat = (layer as any).feature;
  const parts = allPolygonParts(feat && feat.geometry);
  if (!parts.length) return null;
  const props = (feat && feat.properties) || {};
  const iso = props.ADM0_A3 || props.adm0_a3 || null;
  const sov = props.SOV_A3 || props.sov_a3 || null;
  const home = centerOf(parts[0].rings);
  const seen: Record<string, boolean> = {};
  const items: Connector[] = [];

  for (let i = 1; i < parts.length && items.length < CONNECTOR_MAX_LINES; i++) {
    if (parts[i].area < CONNECTOR_MIN_AREA) break; // sorted largest-first
    const tip = centerOf(parts[i].rings);
    const name = nearestSubunitName(iso, tip);
    if (name && !seen[name]) { seen[name] = true; items.push({ tip, name }); }
  }
  const terrs = (sov && territoriesBySov[sov]) || [];
  for (let j = 0; j < terrs.length && items.length < CONNECTOR_MAX_LINES; j++) {
    const t = terrs[j];
    if (t.adm0 === iso || seen[t.name]) continue; // skip the sovereign itself / dupes
    seen[t.name] = true;
    items.push({ tip: [t.lat, t.lng], name: t.name });
  }
  return { home, items };
}

function refreshConnectors(): void {
  connectorLayer.clearLayers();
  if (!selectedLayer) return; // lines show on selection, isolate or not
  const c = computeConnectors(selectedLayer);
  if (!c) return;
  c.items.forEach((it) => {
    L.polyline([c.home, it.tip], {
      color: "#8a3b00", weight: 1, opacity: 0.7, dashArray: "4 4", interactive: false,
    }).addTo(connectorLayer);
    const html = '<a href="' + wikiUrl(it.name) + '" target="_blank" rel="noopener">' + escapeHtml(it.name) + "</a>";
    L.tooltip({
      permanent: true, interactive: true, direction: "right", offset: [6, 0],
      className: "map-label connector-label", opacity: 1,
    }).setLatLng(it.tip).setContent(html).addTo(connectorLayer);
  });
}

// ---------------------------------------------------------------------------
// Flags (scale with zoom)
// ---------------------------------------------------------------------------
function flagIcon(iso2: string, zoom: number): L.DivIcon {
  const scale = Math.min(0.78 + (zoom - 2) * 0.33, 3); // smaller when zoomed out (~19px at z2)
  const w = Math.round(24 * scale), h = Math.round(18 * scale);
  return L.divIcon({
    className: "flag-icon",
    html: '<img src="https://flagcdn.com/48x36/' + iso2 + '.png" width="' + w + '" height="' + h + '" alt="">',
    iconSize: [w, h],
    iconAnchor: [w / 2, h + 8], // sit just above the centroid
  });
}
function updateFlagSizes(): void {
  const z = map.getZoom();
  countries.forEach((e) => {
    if (e.flagMarker && e.iso2) e.flagMarker.setIcon(flagIcon(e.iso2, z));
  });
}

// ---------------------------------------------------------------------------
// Mountain peaks (Explore "Show mountains" layer + quiz markers)
// ---------------------------------------------------------------------------
function peakSize(zoom: number): number { return Math.round(Math.min(22 + (zoom - 2) * 5, 46)); } // grows when zoomed in
function peakLabelOffset(zoom: number): L.PointExpression { return [Math.round(peakSize(zoom) / 4) + 5, 0]; }
function peakIcon(zoom: number, highlight = false): L.DivIcon {
  const w = peakSize(zoom);
  const h = Math.round(w * 22 / 28);
  const body = highlight ? "#e8740c" : "#74879b";
  const edge = highlight ? "#8a3b00" : "#3a4654";
  const svg =
    '<svg width="' + w + '" height="' + h + '" viewBox="0 0 28 22">' +
    '<path d="M1 21 L10.5 3 L16 13 L19.5 7.5 L27 21 Z" fill="' + body + '" stroke="' + edge + '" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M10.5 3 L13.2 8 L10.5 9.6 L8 8 Z" fill="#fff"/>' +
    '<path d="M19.5 7.5 L21.6 11 L19.5 12 L17.6 11 Z" fill="#fff"/>' +
    "</svg>";
  return L.divIcon({
    className: "peak-icon" + (highlight ? " peak-hi" : ""),
    html: svg, iconSize: [w, h], iconAnchor: [Math.round(w / 2), h],
  });
}
const peakMarkers: L.Marker[] = [];
function buildPeakMarkers(): void {
  if (peakMarkers.length) return;
  const z = map.getZoom();
  PEAKS.forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: peakIcon(z), keyboard: false });
    const label = '<a href="' + wikiUrl(p.wiki || p.name) + '" target="_blank" rel="noopener">' + escapeHtml(p.name) +
      '</a> <span class="peak-elev">(' + fmtInt(p.elevation) + " m)</span>";
    m.bindTooltip(label, { permanent: true, direction: "right", offset: peakLabelOffset(z), interactive: true, className: "map-label peak-label" });
    m.on("click", (e) => L.DomEvent.stop(e)); // don't let the icon clear the selection
    peakMarkers.push(m);
  });
}
function refreshPeaks(): void {
  const on = showPeaks && mode === "explore";
  if (on) buildPeakMarkers();
  peakMarkers.forEach((m) => {
    if (on && !peakLayer.hasLayer(m)) peakLayer.addLayer(m);
    else if (!on && peakLayer.hasLayer(m)) peakLayer.removeLayer(m);
  });
  updatePeakLabels();
}

// --- Rivers (Explore "Rivers" layer) — major named river centerlines from
//     Natural Earth, loaded lazily the first time the toggle is switched on. ---
let riverGeo: L.GeoJSON | null = null;
let riversLoading = false;
function loadRivers(): void {
  if (riverGeo || riversLoading) return;
  riversLoading = true;
  fetchJson(RIVER_URLS).then((geo) => {
    riverGeo = L.geoJSON(geo, {
      filter: (f: any) => String((f.properties || {}).featurecla || "").toLowerCase().indexOf("lake") === -1,
      style: () => ({ color: "#3d83c4", weight: 1.5, opacity: 0.85 }),
      onEachFeature: (f: any, layer: L.Layer) => {
        const name = (f.properties || {}).name || (f.properties || {}).name_en;
        if (name) (layer as L.Path).bindTooltip(
          '<a href="' + wikiUrl(name) + '" target="_blank" rel="noopener">' + escapeHtml(name) + "</a>",
          { permanent: true, direction: "center", interactive: true, className: "map-label river-label" });
      },
    });
    riversLoading = false;
    refreshRivers();
  }).catch(() => { riversLoading = false; });
}
function refreshRivers(): void {
  const on = showRivers && mode === "explore";
  if (on && !riverGeo) { loadRivers(); return; }
  if (!riverGeo) return;
  if (on && !riverLayer.hasLayer(riverGeo)) riverLayer.addLayer(riverGeo);
  else if (!on && riverLayer.hasLayer(riverGeo)) riverLayer.removeLayer(riverGeo);
  updatePeakLabels();
}

// --- Lakes (Explore "Lakes" layer) — major lakes from Natural Earth, lazy. ---
let lakeGeo: L.GeoJSON | null = null;
let lakesLoading = false;
function loadLakes(): void {
  if (lakeGeo || lakesLoading) return;
  lakesLoading = true;
  fetchJson(LAKE_URLS).then((geo) => {
    const lakeName = (f: any) => (f.properties || {}).name || (f.properties || {}).name_en;
    const areaOf = (f: any) => { try { return allPolygonParts(f.geometry).reduce((s: number, p) => s + Math.abs(p.area), 0); } catch { return 0; } };
    // Named lakes only, and when a name appears on several polygons (NE splits or
    // mislabels — e.g. a second "Femunden" that's really Isteren) keep the label on
    // the largest one so it isn't shown twice.
    const named = ((geo.features || []) as any[]).filter((f) => lakeName(f));
    named.forEach((f) => { f.__a = areaOf(f); });
    const best: Record<string, any> = {};
    named.forEach((f) => { const n = lakeName(f); if (!best[n] || f.__a > best[n].__a) best[n] = f; });
    lakeGeo = L.geoJSON({ type: "FeatureCollection", features: named } as any, {
      style: () => ({ color: "#2e7cc4", weight: 0.8, opacity: 0.9, fillColor: "#7bb8e8", fillOpacity: 0.85 }),
      onEachFeature: (f: any, layer: L.Layer) => {
        if (best[lakeName(f)] !== f) return; // only the largest polygon per name gets a label
        (layer as L.Path).bindTooltip(
          '<a href="' + wikiUrl(lakeName(f)) + '" target="_blank" rel="noopener">' + escapeHtml(lakeName(f)) + "</a>",
          { permanent: true, direction: "center", interactive: true, className: "map-label lake-label" });
      },
    });
    lakesLoading = false;
    refreshLakes();
  }).catch(() => { lakesLoading = false; });
}
function refreshLakes(): void {
  const on = showLakes && mode === "explore";
  if (on && !lakeGeo) { loadLakes(); return; }
  if (!lakeGeo) return;
  if (on && !lakeLayer.hasLayer(lakeGeo)) lakeLayer.addLayer(lakeGeo);
  else if (!on && lakeLayer.hasLayer(lakeGeo)) lakeLayer.removeLayer(lakeGeo);
  updatePeakLabels();
}
// Peak/river names get crowded when zoomed out, so hide the labels below a zoom
// threshold — the icons and lines still show every feature.
function updatePeakLabels(): void {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  const on = map.getZoom() >= 4;
  mapEl.classList.toggle("peak-labels-on", on);
  mapEl.classList.toggle("river-labels-on", on);
  mapEl.classList.toggle("lake-labels-on", on);
}
function updatePeakSizes(): void {
  const z = map.getZoom();
  const off = peakLabelOffset(z);
  peakMarkers.forEach((m) => {
    m.setIcon(peakIcon(z));
    const tt = m.getTooltip();
    if (tt) { tt.options.offset = L.point(off); tt.update(); } // keep the label clear of the (resized) icon
  });
  updatePeakLabels();
}
function peakCountryNames(p: Peak): string {
  if (!p.iso.length) return "Antarctica";
  return p.iso.map((c) => (byIso[c] ? byIso[c].name : c)).join(" / ");
}
// ---------------------------------------------------------------------------
// Refresh pipeline + selection
// ---------------------------------------------------------------------------
function refreshAll(): void {
  refreshPolygons();
  refreshConnectors();
  refreshCountryLabels();
  refreshCapitals();
  refreshFlags();
  refreshPeaks();
  refreshRivers();
  refreshLakes();
  updateInfoPanel();
  markActiveContinent();
  updateRegionLabels();
}

/** Single-country selection; toggle=true (map click) deselects the same country.
 *  A selected continent is kept, so picking a country inside it keeps the
 *  continent highlighted (green) with the country shown selected (orange). */
function selectLayer(layer: L.Polygon, toggle: boolean): void {
  selectedLayer = toggle && selectedLayer === layer ? null : layer;
  if (selectedLayer) selectedLayer.bringToFront();
  refreshAll();
}
function deselect(): void {
  if (selectedLayer || selectedContinent) { selectedLayer = null; selectedContinent = null; refreshAll(); }
}

// Select a whole continent: highlight all member countries and show aggregate
// info. Clicking the active continent again clears it. (Mutually exclusive with
// single-country selection.)
function selectContinent(name: string): void {
  selectedLayer = null;
  selectedContinent = selectedContinent === name ? null : name;
  if (selectedContinent) {
    let b: L.LatLngBounds | null = null;
    countries.forEach((e) => {
      if (groupOf(e) !== selectedContinent) return;
      try {
        const lb = e.layer.getBounds();
        b = b ? b.extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
      } catch { /* skip */ }
    });
    if (b) { try { map.fitBounds(b, { padding: [30, 30], maxZoom: 6 }); } catch { /* ignore */ } }
  }
  refreshAll();
}

function focusCountry(entry: CountryEntry): void {
  try { map.fitBounds(entry.layer.getBounds(), { maxZoom: 6, padding: [40, 40] }); } catch {}
  selectLayer(entry.layer, false); // sidebar click always selects (no toggle)
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
const CONTINENT_ORDER = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Antarctica", "Other"];
let activeTab: "countries" | "continents" = "countries";
let listExpanded = true; // the Countries/Continents list section is foldable

// Single source of truth for what the list section shows, given the active tab
// and whether the section is expanded. Collapsing hides the filter row + lists.
function updateListVisibility(): void {
  const countries$ = activeTab === "countries";
  (document.getElementById("country-list") as HTMLElement).hidden = !listExpanded || !countries$;
  (document.getElementById("continent-list") as HTMLElement).hidden = !listExpanded || countries$;
  (document.querySelector(".filter-sort") as HTMLElement).style.display = listExpanded ? "" : "none";
  (document.querySelector(".search-wrap") as HTMLElement).style.display = countries$ ? "" : "none";
  // The "Group by" scheme picker belongs only to the Regions tab.
  (document.getElementById("scheme-row") as HTMLElement).hidden = countries$ || !listExpanded;
  const sec = document.querySelector(".sb-tabsec") as HTMLElement;
  if (sec) sec.classList.toggle("collapsed", !listExpanded);
}
function setListExpanded(on: boolean): void { listExpanded = on; updateListVisibility(); }
let expandedContinent: string | null = null; // which continent's countries are shown in the Continents tab
let sortBy: "name" | "population" | "area" = "name";

// Compact value with 2 decimals + magnitude suffix, e.g. 1.41B, 5.43M, 323.80K.
function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
// The value shown in parentheses for the current sort (empty when sorting by name).
function metricLabel(value: number): string {
  if (sortBy === "population") return " (" + formatCompact(value) + ")";
  if (sortBy === "area") return " (" + formatCompact(value) + " km²)";
  return "";
}

function popOf(e: CountryEntry): number {
  const p = ((e.layer as any).feature && (e.layer as any).feature.properties) || {};
  return p.POP_EST || 0;
}
function areaOf(e: CountryEntry): number {
  return (countryData && e.iso && countryData[e.iso] && countryData[e.iso].area) || 0;
}
// Comparator for the current sort: population/area descending, else A–Z.
function cmpCountries(a: CountryEntry, b: CountryEntry): number {
  if (sortBy === "population") return popOf(b) - popOf(a) || a.name.localeCompare(b.name);
  if (sortBy === "area") return areaOf(b) - areaOf(a) || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name);
}

function makeCountryLi(entry: CountryEntry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "country";
  li.dataset.name = entry.name.toLowerCase();

  const label = document.createElement("span");
  label.textContent = entry.name;
  label.title = "Zoom to " + entry.name + " on the map";
  label.style.flex = "1";
  label.addEventListener("click", () => focusCountry(entry));
  if (sortBy !== "name") {
    const m = document.createElement("span");
    m.className = "metric";
    m.textContent = metricLabel(sortBy === "population" ? popOf(entry) : areaOf(entry));
    label.appendChild(m);
  }

  const wiki = document.createElement("a");
  wiki.textContent = "Wiki ↗";
  wiki.href = wikiUrl(entry.name);
  wiki.target = "_blank";
  wiki.rel = "noopener";

  li.appendChild(label);
  li.appendChild(wiki);
  return li;
}

// Real countries exclude the Antarctica landmass (a continent, not a country).
function realCountries(): CountryEntry[] { return countries.filter((c) => !c.isLandmass); }

// Filter the flat country list by the search box; update the Countries tab count.
function applyFilter(): void {
  const ul = document.getElementById("country-list")!;
  const search = document.getElementById("search") as HTMLInputElement;
  const q = search.value.trim().toLowerCase();
  const total = realCountries().length;
  let shown = 0;
  ul.querySelectorAll<HTMLElement>("li.country").forEach((li) => {
    const matches = (li.dataset.name || "").indexOf(q) !== -1;
    if (matches) shown++;
    li.style.display = matches ? "" : "none";
  });
  const countNum = document.getElementById("count-num")!;
  countNum.textContent = q ? shown + " of " + total : String(total);
}

// Highlight the active continent header (the one shown on the map).
function markActiveContinent(): void {
  document.querySelectorAll<HTMLElement>("#continent-list li.cont-head").forEach((h) => {
    h.classList.toggle("active", h.dataset.group === selectedContinent);
  });
}

// Continents tab: each continent is a header; the expanded one lists its
// member countries beneath. Clicking a header expands it AND highlights the
// continent on the map; clicking a member selects that single country.
function buildContinentList(): void {
  rebuildRegionColors();
  const counts: Record<string, number> = {};
  const byCont: Record<string, CountryEntry[]> = {};
  countries.forEach((e) => {
    const g = groupOf(e);
    if (e.isLandmass) { counts[g] = counts[g] || 0; return; } // list the group, 0 countries
    counts[g] = (counts[g] || 0) + 1;
    (byCont[g] = byCont[g] || []).push(e);
  });
  const order = Object.keys(counts);
  if (sortBy === "name") {
    order.sort((a, b) => {
      const ia = CONTINENT_ORDER.indexOf(a), ib = CONTINENT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  } else {
    // Sort continents by total population / area of their members (descending).
    const metric = (g: string) => (byCont[g] || []).reduce((s, e) => s + (sortBy === "population" ? popOf(e) : areaOf(e)), 0);
    order.sort((a, b) => metric(b) - metric(a) || a.localeCompare(b));
  }

  const cl = document.getElementById("continent-list")!;
  cl.innerHTML = "";
  order.forEach((g) => {
    const head = document.createElement("li");
    head.className = "cont-head" + (expandedContinent === g ? " expanded" : "") +
      (selectedContinent === g ? " active" : "");
    head.dataset.group = g;
    head.title = "Show all of " + g + " on the map";
    const total = sortBy === "name" ? 0
      : (byCont[g] || []).reduce((s, e) => s + (sortBy === "population" ? popOf(e) : areaOf(e)), 0);
    const metric = sortBy === "name" ? "" : '<span class="metric">' + metricLabel(total) + "</span>";
    const hue = regionHue[g];
    const sw = hue != null ? '<span class="cont-swatch" style="background:hsl(' + hue + ',60%,62%)"></span>' : "";
    head.innerHTML = '<span class="cont-name"><span class="caret">▾</span>' + sw + escapeHtml(g) + metric +
      '</span><span class="cnt">' + counts[g] + "</span>";
    head.addEventListener("click", () => {
      if (expandedContinent === g) { expandedContinent = null; deselect(); }
      else { expandedContinent = g; selectContinent(g); }
      buildContinentList();
    });
    cl.appendChild(head);

    if (expandedContinent === g) {
      (byCont[g] || []).slice().sort(cmpCountries).forEach((entry) => {
        const li = makeCountryLi(entry);
        li.classList.add("cont-member");
        cl.appendChild(li);
      });
    }
  });
  document.getElementById("cont-num")!.textContent = String(order.length);
}

function buildSidebar(): void {
  // Flat country list (Countries tab) — excludes the Antarctica landmass.
  const ul = document.getElementById("country-list")!;
  ul.innerHTML = "";
  realCountries().sort(cmpCountries).forEach((entry) => ul.appendChild(makeCountryLi(entry)));
  document.getElementById("count-num")!.textContent = String(realCountries().length);

  buildContinentList();
  applyFilter();
}

function setActiveTab(tab: "countries" | "continents"): void {
  activeTab = tab;
  // Each tab owns its selection type — clear the other tab's selection so a
  // continent highlight doesn't linger on the Countries tab (and vice versa).
  if (tab === "countries") { selectedContinent = null; expandedContinent = null; }
  else { selectedLayer = null; }

  document.querySelectorAll<HTMLElement>(".sb-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  updateListVisibility();

  buildContinentList(); // reflect cleared expand/selection state
  refreshAll();         // restyle map, panels, reveals (toggle scope depends on tab)
}

// ---------------------------------------------------------------------------
// Labels + flags placement
// ---------------------------------------------------------------------------
function placeCountryLabels(): void {
  countries.forEach((entry) => {
    if (entry.labelPlaced) return;
    let parts;
    try { parts = allPolygonParts(entry.layer.feature && entry.layer.feature.geometry); }
    catch { parts = []; }
    if (!parts.length || !parts[0].rings[0] || parts[0].rings[0].length < 3) return;

    const center = centerOf(parts[0].rings);
    const html = '<a href="' + wikiUrl(entry.name) + '" target="_blank" rel="noopener">' + escapeHtml(entry.name) + "</a>";
    entry.labelTooltip = L.tooltip({
      permanent: true, direction: "center", offset: [0, 0],
      className: "map-label country-label", opacity: 1, interactive: true,
    }).setLatLng(center).setContent(html).addTo(map);

    if (entry.iso2) {
      entry.flagMarker = L.marker(center, {
        interactive: false, keyboard: false, icon: flagIcon(entry.iso2, map.getZoom()),
      });
    }
    entry.labelPlaced = true;
  });
  refreshFlags();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function fetchJson(urls: string[]): Promise<any> {
  let i = 0;
  const attempt = (): Promise<any> => {
    if (i >= urls.length) return Promise.reject(new Error("All sources failed"));
    return fetch(urls[i])
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .catch(() => { i++; return attempt(); });
  };
  return attempt();
}

function loadCapitals(): void {
  fetchJson(CAPITAL_URLS).then((geo) => {
    let feats = (geo.features || []).filter((f: any) => {
      const fc = ((f.properties && f.properties.featurecla) || "").toLowerCase();
      return fc === "admin-0 capital"; // national capitals only
    });
    const seen: Record<string, boolean> = {};
    feats = feats.filter((f: any) => {
      const c = (f.properties && (f.properties.adm0_a3 || f.properties.adm0name)) || f.properties.name;
      if (seen[c]) return false;
      seen[c] = true;
      return true;
    });

    const entryByIso: Record<string, CountryEntry> = {};
    const entryByName: Record<string, CountryEntry> = {};
    countries.forEach((e) => {
      if (e.iso) entryByIso[e.iso] = e;
      entryByName[e.name.toLowerCase()] = e;
    });

    feats.forEach((f: any) => {
      const p = f.properties || {};
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) return;
      const lat = coords[1], lng = coords[0];
      const capName = p.name || p.nameascii || "Capital";
      const cIso = p.adm0_a3 || p.sov_a3 || null;
      const cCountry = (p.adm0name || p.sov0name || "").toLowerCase();

      const marker = L.circleMarker([lat, lng], {
        radius: 4, color: "#b3261e", weight: 1.5, fillColor: "#ffffff", fillOpacity: 1,
      }) as CapitalMarker;
      const capLink = '<a href="' + cityWikiUrl(capName) + '" target="_blank" rel="noopener">' + escapeHtml(capName) + "</a>";
      marker.bindTooltip(capLink, {
        permanent: true, interactive: true, direction: "right", offset: [6, 0],
        className: "map-label capital-label", opacity: 1,
      });

      const e = (cIso && entryByIso[cIso]) || entryByName[cCountry] || null;
      marker._entry = e;
      if (e) { e.capitalMarker = marker; e.capitalName = capName; }
      capitalMarkers.push(marker);
    });
    refreshCapitals();
  }).catch(() => { /* capitals optional */ });
}

function loadSubunits(): void {
  fetchJson(SUBUNIT_URLS).then((geo) => {
    (geo.features || []).forEach((f: any) => {
      const p = f.properties || {};
      const iso = p.ADM0_A3 || p.adm0_a3 || null;
      const name = p.SUBUNIT || p.NAME || p.GEOUNIT || p.name || null;
      if (!iso || !name) return;
      const parts = allPolygonParts(f.geometry);
      if (!parts.length || !parts[0].rings[0] || parts[0].rings[0].length < 3) return;
      const c = centerOf(parts[0].rings);
      (subunitsByIso[iso] = subunitsByIso[iso] || []).push({ name, lat: c[0], lng: c[1] });
    });
    refreshConnectors();
  }).catch(() => { /* names optional */ });
}

function loadBorders(): void {
  fetchJson(BORDER_URLS).then((geo) => {
    const layer = L.geoJSON(geo, {
      // Keep sovereign states (+ disputed/indeterminate). Drop dependencies and
      // leases (e.g. Ashmore and Cartier Islands, French Polynesia, Puerto Rico),
      // and Antarctica (a treaty-governed continent, not a country), but record
      // EVERY feature under its sovereign for sovereignty links.
      filter: (feature: any) => {
        const p = feature.properties || {};
        const sov = p.SOV_A3 || p.sov_a3, adm0 = p.ADM0_A3 || p.adm0_a3;
        const nm = p.ADMIN || p.NAME_LONG || p.NAME || p.name;
        if (sov && adm0 && nm) {
          try {
            const prt = allPolygonParts(feature.geometry);
            if (prt.length && prt[0].rings[0] && prt[0].rings[0].length >= 3) {
              const c = centerOf(prt[0].rings);
              (territoriesBySov[sov] = territoriesBySov[sov] || []).push({ name: nm, adm0, lat: c[0], lng: c[1] });
            }
          } catch { /* skip */ }
        }
        const t = p.TYPE || "";
        // Antarctica (ATA) is kept as a continent landmass (handled specially in
        // onEachFeature), not dropped like dependencies/leases.
        return t !== "Dependency" && t !== "Lease";
      },
      style: () => baseStyle,
      onEachFeature: (feature: any, lyr: L.Layer) => {
        const layerP = lyr as L.Polygon;
        const pr = feature.properties || {};
        const name = pr.ADMIN || pr.NAME_LONG || pr.admin || pr.name || pr.NAME || feature.id || "Unknown";
        const iso = pr.ADM0_A3 || pr.adm0_a3 || pr.ISO_A3 || pr.iso_a3 || feature.id || null;
        const a2 = pr.ISO_A2_EH || pr.ISO_A2 || pr.WB_A2 || "";
        const iso2 = /^[A-Za-z]{2}$/.test(a2) ? a2.toLowerCase() : null;
        let continent = pr.CONTINENT || pr.continent || "Other";
        if (/seven seas/i.test(continent)) continent = "Other"; // open-ocean islands
        const isLandmass = iso === "ATA";                       // Antarctica: continent, not a country
        if (isLandmass) continent = "Antarctica";
        const entry: CountryEntry = { name, layer: layerP, iso, iso2, continent, isLandmass };
        countries.push(entry);
        if (iso) byIso[iso] = entry;
        layerP.on({
          // Hover only restyles the polygon (and, in Explore, shows the off-map
          // info panel) — no on-map labels, no bringToFront — so it can never
          // cancel a click.
          mouseover: () => {
            hoveredLayer = layerP;
            hoveredContinent = mode === "quiz" ? (entry.continent || "Other") : groupOf(entry);
            refreshPolygons();
            // The selected country already shows its flag + name on the map and in
            // the fact panel, so skip the redundant hover tooltip for it.
            if (mode === "explore") { if (layerP === selectedLayer) hideHoverInfo(); else showHoverInfo(entry); }
          },
          mouseout: () => { if (hoveredLayer === layerP) { hoveredLayer = null; hoveredContinent = null; } refreshPolygons(); if (mode === "explore") hideHoverInfo(); },
          click: (e) => {
            L.DomEvent.stop(e);
            suppressMapClick = true;
            setTimeout(() => { suppressMapClick = false; }, 0);
            if (mode === "quiz") {
              if (quizType === "continent") { if (!entry.isLandmass) answerContinent(entry.continent || "Other"); }
              else if (quizType === "neighbour") { if (nbMode === "map" && !entry.isLandmass && entry !== quizTarget) toggleNbPick(entry); }
              else if (quizType === "peakcountry") { if (!entry.isLandmass) handlePeakCountryGuess(entry); }
              else if (quizType === "peakname") { /* answered via the choice buttons */ }
              else { if (locMode === "map") handleGuess(entry); }
              return;
            }
            // The Antarctica landmass selects its region group, not a "country".
            if (isLandmass) selectContinent(groupOf(entry)); else selectLayer(layerP, true);
          },
        });
      },
    }).addTo(map);

    (map as any).borderLayer = layer;
    buildSidebar();
    setActiveTab("countries");
    placeCountryLabels();

    // Natural Earth already splits North/South America correctly, but leaves some
    // ocean island states without a continent ("Seven seas (open ocean)" → "Other").
    // Only fix those orphans from mledoze (and only to one of our known seven), so
    // we never merge the Americas or disturb NE's good assignments.
    loadCountryData().then((data) => {
      let changed = false;
      countries.forEach((e) => {
        if (e.isLandmass || !e.iso || e.continent !== "Other") return;
        const d = data[e.iso];
        if (d && d.continent && CONTINENT_ORDER.indexOf(d.continent) !== -1) {
          e.continent = d.continent;
          changed = true;
        }
      });
      if (changed) buildSidebar();
    }).catch(() => { /* keep Natural Earth continents if unavailable */ });
    refreshCountryLabels(); // honour default (names off) once labels exist
    hideStatus();
    loadCapitals();
    loadSubunits();
  }).catch((e: Error) => {
    setStatus("Could not load country borders. Check your internet connection. (" + e.message + ")");
  });
}

// ---------------------------------------------------------------------------
// Quiz mode
// ---------------------------------------------------------------------------
const quizPromptEl = document.getElementById("quiz-prompt")!;
const quizFeedbackEl = document.getElementById("quiz-feedback")!;
const quizScoreEl = document.getElementById("quiz-score")!;
const quizChoicesEl = document.getElementById("quiz-choices")!;
const quizNextBtn = document.getElementById("quiz-next") as HTMLButtonElement;
const quizSkipBtn = document.getElementById("quiz-skip") as HTMLButtonElement;

function renderQuizPrompt(): void {
  if (quizType === "peakname") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">peak</span> <span>Which mountain?</span>';
    return;
  }
  if (quizType === "peakcountry") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">peak</span> <span>' + escapeHtml(quizPeak ? quizPeak.name : "") + "</span>";
    return;
  }
  if (!quizTarget) { quizPromptEl.innerHTML = ""; return; }
  if (quizType === "flag") {
    // Flag quiz: show only the flag (no name) — identify it and click it.
    quizPromptEl.innerHTML = quizTarget.iso2
      ? '<img class="quiz-bigflag" src="https://flagcdn.com/96x72/' + quizTarget.iso2 + '.png" alt="Flag">'
      : "(no flag available)";
  } else if (quizType === "capital") {
    // Capital quiz: show the capital city; click its country.
    quizPromptEl.innerHTML = quizTarget.capitalName
      ? '<span class="quiz-cap-tag">capital</span> <span>' + escapeHtml(quizTarget.capitalName) + "</span>"
      : "(no capital)";
  } else if (quizType === "continent" || quizType === "neighbour") {
    // Show the country (flag + name); pick its continent / click a neighbour.
    const flag = quizTarget.iso2 ? '<img src="https://flagcdn.com/40x30/' + quizTarget.iso2 + '.png" alt="">' : "";
    quizPromptEl.innerHTML = flag + "<span>" + escapeHtml(quizTarget.name) + "</span>";
  } else if (quizType === "spot") {
    // Spot quiz: the country is highlighted/pinned on the map — naming it is the
    // task, so the prompt must NOT reveal the name.
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">pinned</span> <span>Which country?</span>';
  } else {
    // Name quiz: just the name (no flag — that would give it away).
    quizPromptEl.innerHTML = "<span>" + escapeHtml(quizTarget.name) + "</span>";
  }
}
function renderQuizScore(): void {
  quizScoreEl.textContent = quizTotal ? "Score: " + quizCorrect + " / " + quizTotal : "";
}
function layerCenter(entry: CountryEntry): LatLng | null {
  try {
    const parts = allPolygonParts((entry.layer as any).feature && (entry.layer as any).feature.geometry);
    if (parts.length) return centerOf(parts[0].rings);
  } catch { /* ignore */ }
  return null;
}

// Neighbouring countries (mledoze `borders`, resolved to entries we have).
function neighbourEntries(entry: CountryEntry): CountryEntry[] {
  const codes = (countryData && entry.iso && countryData[entry.iso] && countryData[entry.iso].borders) || [];
  return codes.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
}

function nextQuestion(): void {
  // The neighbour quiz needs the borders dataset; load it first if necessary.
  if (quizType === "neighbour" && !countryData) {
    loadCountryData().then(() => nextQuestion()).catch(() => { /* ignore */ });
    return;
  }
  if (quizType === "peakname" || quizType === "peakcountry") { nextPeakQuestion(); return; }
  // Restrict the pool to countries that have what the prompt needs.
  const pool = quizType === "flag" ? realCountries().filter((c) => c.iso2)
    : quizType === "capital" ? realCountries().filter((c) => c.capitalName)
    : quizType === "neighbour" ? realCountries().filter((c) => neighbourEntries(c).length > 0)
    : realCountries();
  if (!pool.length) return;
  let t = quizTarget;
  for (let i = 0; i < 20 && (!t || t === quizTarget); i++) t = pool[Math.floor(Math.random() * pool.length)];
  quizTarget = t;
  quizGuess = null;
  quizAnswered = false;
  quizContCorrect = null;
  quizContWrong = null;
  quizNeighbourSet = quizType === "neighbour" && t ? new Set(neighbourEntries(t)) : new Set();
  quizLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (quizType === "continent") {
    showContinentLabels();
    quizChoicesEl.hidden = true;
    nbBox.hidden = true;
    locBox.hidden = true;
    quizFeedbackEl.textContent = "Click any country in its continent on the map.";
  } else if (quizType === "neighbour") {
    quizChoicesEl.hidden = true;
    locBox.hidden = true;
    quizContLayer.clearLayers();
    nbSelected = new Set();
    nbInput.value = ""; nbInput.disabled = false;
    nbResults.innerHTML = "";
    renderNbChips();
    nbCheck.disabled = false;
    nbBox.hidden = false;
    applyNbMode();
  } else if (quizType === "spot") {
    // Spot: highlight + drop a pin on a random country; the user names it by
    // search. Reset to the world view so the pin is always on screen.
    quizChoicesEl.hidden = true;
    quizContLayer.clearLayers();
    nbBox.hidden = true;
    locInput.value = ""; locInput.disabled = false;
    locResults.innerHTML = "";
    locBox.hidden = false;
    locModeEl.hidden = true;     // always answered by typing the name
    locMode = "search";
    applyLocMode();
    const c = quizTarget ? layerCenter(quizTarget) : null;
    map.setView([20, 0], 2);
    if (c) L.circleMarker(c, { radius: 9, color: "#8a3b00", weight: 3, fillColor: "#e8740c", fillOpacity: 0.9 }).addTo(quizLayer);
    quizFeedbackEl.textContent = "Which country is highlighted? Type its name.";
  } else {
    quizChoicesEl.hidden = true;
    quizContLayer.clearLayers();
    nbBox.hidden = true;
    locInput.value = ""; locInput.disabled = false;
    locResults.innerHTML = "";
    locBox.hidden = false;
    // "By name" already gives you the name, so searching for it is pointless —
    // hide the mode picker and force map clicks. Flag/capital keep both options.
    const nameOnly = quizType === "name";
    locModeEl.hidden = nameOnly;
    if (nameOnly) {
      locMode = "map";
      const mapRadio = document.querySelector<HTMLInputElement>('#loc-mode input[value="map"]');
      if (mapRadio) mapRadio.checked = true;
    }
    applyLocMode();
  }
  quizNextBtn.disabled = true;
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Mountain-peak quiz (Name it / Which country)
// ---------------------------------------------------------------------------
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function drawQuizPeak(withLabel: boolean): void {
  quizLayer.clearLayers();
  if (!quizPeak) return;
  const m = L.marker([quizPeak.lat, quizPeak.lng], { icon: peakIcon(map.getZoom(), true), keyboard: false });
  if (withLabel) {
    m.bindTooltip('<a href="' + wikiUrl(quizPeak.wiki || quizPeak.name) + '" target="_blank" rel="noopener">' +
      escapeHtml(quizPeak.name) + "</a>", { permanent: true, direction: "top", interactive: true, className: "map-label" });
  }
  m.addTo(quizLayer);
}
function renderPeakChoices(): void {
  if (!quizPeak) return;
  const distract = shuffle(PEAKS.filter((p) => p !== quizPeak)).slice(0, 3);
  quizChoicesEl.innerHTML = "";
  shuffle([quizPeak, ...distract]).forEach((p) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.name; b.dataset.peak = p.name;
    b.addEventListener("click", () => handlePeakNameGuess(p.name));
    quizChoicesEl.appendChild(b);
  });
}
function nextPeakQuestion(): void {
  const pool = quizType === "peakcountry" ? PEAKS.filter((p) => p.iso.length) : PEAKS;
  if (!pool.length) return;
  let p = quizPeak;
  for (let i = 0; i < 20 && (!p || p === quizPeak); i++) p = pool[Math.floor(Math.random() * pool.length)];
  quizPeak = p;
  quizTarget = null; quizGuess = null; quizAnswered = false;
  quizContCorrect = null; quizContWrong = null; quizNeighbourSet = new Set();
  nbBox.hidden = true; locBox.hidden = true;
  quizContLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (quizType === "peakname") {
    renderPeakChoices();
    quizChoicesEl.hidden = false;
    quizFeedbackEl.textContent = "Which mountain is marked? Pick one.";
  } else {
    quizChoicesEl.hidden = true;
    quizFeedbackEl.textContent = "In which country is " + (quizPeak ? quizPeak.name : "") + "? Click it on the map.";
  }
  if (quizPeak) map.setView([quizPeak.lat, quizPeak.lng], 4);
  drawQuizPeak(false);
  quizNextBtn.disabled = true;
  refreshPolygons();
}
function handlePeakNameGuess(name: string): void {
  if (mode !== "quiz" || quizAnswered || !quizPeak) return;
  quizAnswered = true; quizTotal++;
  const ok = name === quizPeak.name;
  if (ok) quizCorrect++;
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const n = btn.dataset.peak;
    if (n === quizPeak!.name) btn.classList.add("correct");
    else if (n === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "✓ Correct! " : "✗ It's ") + quizPeak.name +
    " — " + fmtInt(quizPeak.elevation) + " m, " + peakCountryNames(quizPeak) + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawQuizPeak(true);
}
function handlePeakCountryGuess(entry: CountryEntry): void {
  if (mode !== "quiz" || quizAnswered || !quizPeak || entry.isLandmass) return;
  quizGuess = entry; quizAnswered = true; quizTotal++;
  const ok = !!entry.iso && quizPeak.iso.includes(entry.iso);
  if (ok) quizCorrect++;
  const names = peakCountryNames(quizPeak);
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + quizPeak.name + " is in " + names + "."
    : "✗ That's " + entry.name + ". " + quizPeak.name + " is in " + names + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawQuizPeak(true);
  refreshPolygons();
}

// Distinct tint per continent while the continent quiz question is open.
const CONTINENT_QUIZ_STYLES: Record<string, L.PathOptions> = {
  "Africa":        { color: "#b8860b", weight: 1, opacity: 1, fillColor: "#f2c14e", fillOpacity: 0.55 },
  "Asia":          { color: "#b1472f", weight: 1, opacity: 1, fillColor: "#e8896c", fillOpacity: 0.55 },
  "Europe":        { color: "#2f5fa0", weight: 1, opacity: 1, fillColor: "#7fb2e8", fillOpacity: 0.55 },
  "North America": { color: "#2e7d4b", weight: 1, opacity: 1, fillColor: "#8fd0a0", fillOpacity: 0.55 },
  "South America": { color: "#7a4ba0", weight: 1, opacity: 1, fillColor: "#c79be0", fillOpacity: 0.55 },
  "Oceania":       { color: "#1f8a80", weight: 1, opacity: 1, fillColor: "#6fcbc3", fillOpacity: 0.55 },
};
// Approximate on-map position for each continent's name label.
const CONTINENT_LABEL_POS: Record<string, [number, number]> = {
  "Africa": [3, 20], "Asia": [47, 89], "Europe": [54, 22],
  "North America": [46, -100], "South America": [-15, -60], "Oceania": [-25, 134],
};
function showContinentLabels(): void {
  quizContLayer.clearLayers();
  const present = Array.from(new Set(realCountries().map((c) => c.continent || "Other"))).filter((c) => c !== "Other");
  present.forEach((c) => {
    const pos = CONTINENT_LABEL_POS[c];
    if (!pos) return;
    L.tooltip({ permanent: true, direction: "center", interactive: false, className: "map-label quiz-cont-label" })
      .setLatLng(pos).setContent(escapeHtml(c)).addTo(quizContLayer);
  });
}

// Area-weighted centre of a region's member countries, with a circular mean for
// longitude so regions straddling the antimeridian don't land in mid-ocean.
function groupLabelPos(members: CountryEntry[]): [number, number] | null {
  let sx = 0, sy = 0, slat = 0, w = 0;
  members.forEach((e) => {
    const c = layerCenter(e);
    if (!c) return;
    let wt = 1;
    try { const b = e.layer.getBounds(); wt = Math.max(0.01, (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest())); } catch { /* keep 1 */ }
    const r = (c[1] * Math.PI) / 180;
    sx += wt * Math.cos(r); sy += wt * Math.sin(r); slat += wt * c[0]; w += wt;
  });
  if (!w) return null;
  return [slat / w, (Math.atan2(sy, sx) * 180) / Math.PI];
}

// Explore Regions tab: draw each region's name on the map (like the continent
// quiz). Cleared in the quiz and on the Countries tab.
function updateRegionLabels(): void {
  regionLabelLayer.clearLayers();
  if (mode !== "explore" || activeTab !== "continents") return;
  const byGroup: Record<string, CountryEntry[]> = {};
  realCountries().forEach((e) => { const g = groupOf(e); if (g !== "Other") (byGroup[g] = byGroup[g] || []).push(e); });
  Object.keys(byGroup).forEach((g) => {
    const pos = (groupScheme === "continent" && CONTINENT_LABEL_POS[g]) || groupLabelPos(byGroup[g]);
    if (!pos) return;
    const hue = regionHue[g];
    const html = hue != null
      ? '<span style="color:hsl(' + hue + ',55%,30%)">' + escapeHtml(g) + "</span>"
      : escapeHtml(g);
    L.tooltip({ permanent: true, direction: "center", interactive: false, className: "map-label region-name-label" })
      .setLatLng(pos).setContent(html).addTo(regionLabelLayer);
  });
}

function answerContinent(name: string): void {
  if (mode !== "quiz" || quizType !== "continent" || !quizTarget || quizAnswered) return;
  quizAnswered = true;
  quizTotal++;
  const correct = quizTarget.continent || "Other";
  const ok = name === correct;
  if (ok) quizCorrect++;
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const c = btn.dataset.continent;
    if (c === correct) btn.classList.add("correct");
    else if (c === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + quizTarget.name + " is in " + correct + "."
    : "✗ " + quizTarget.name + " is in " + correct + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Colour the correct continent green (and the guessed one red) on the map,
  // and mark where the country itself is.
  quizContCorrect = correct;
  quizContWrong = ok ? null : name;
  refreshPolygons();
  quizLayer.clearLayers();
  const c = layerCenter(quizTarget);
  if (c) addQuizDot(quizTarget, c, "correct");
}

// --- Neighbour quiz: pick all bordering countries (search box + map clicks),
//     then Check ---
const nbBox = document.getElementById("nb-box") as HTMLElement;
const nbInput = document.getElementById("nb-input") as HTMLInputElement;
const nbResults = document.getElementById("nb-results")!;
const nbChips = document.getElementById("nb-chips")!;
const nbCheck = document.getElementById("nb-check") as HTMLButtonElement;
let nbSelected = new Set<CountryEntry>();
// Two mutually-exclusive ways to answer the Neighbour round: click the
// neighbours on the map, or search and pick them by name.
let nbMode: "map" | "search" = "map";
function applyNbMode(): void {
  nbBox.classList.toggle("map-mode", nbMode === "map");
  if (nbMode === "map") { nbInput.value = ""; renderNbResults(""); }
  if (mode === "quiz" && quizType === "neighbour" && !quizAnswered) {
    quizFeedbackEl.textContent = nbMode === "map"
      ? "Click every country that borders it on the map, then Check."
      : "Search and add every country that borders it, then Check.";
  }
}

// --- Locate quizzes (name / flag / capital): answer by clicking the map or by
//     searching for the country by name. The two are mutually exclusive. ---
const locBox = document.getElementById("loc-box") as HTMLElement;
const locModeEl = document.getElementById("loc-mode") as HTMLElement;
const locInput = document.getElementById("loc-input") as HTMLInputElement;
const locResults = document.getElementById("loc-results")!;
let locMode: "map" | "search" = "map";

function applyLocMode(): void {
  locBox.classList.toggle("map-mode", locMode === "map");
  if (locMode === "map") { locInput.value = ""; renderLocResults(""); }
  if (mode === "quiz" && isLocateQuiz() && !quizAnswered) {
    quizFeedbackEl.textContent = locMode === "map"
      ? "Click it on the map."
      : "Find and select the country.";
  }
}
function isLocateQuiz(): boolean {
  return quizType === "name" || quizType === "flag" || quizType === "capital";
}
function renderLocResults(query: string): void {
  const q = query.trim().toLowerCase();
  locResults.innerHTML = "";
  if (!q) return;
  realCountries()
    .filter((c) => c.name.toLowerCase().indexOf(q) !== -1)
    .slice(0, 8)
    .forEach((c) => {
      const li = document.createElement("li");
      const flag = c.iso2 ? '<img src="https://flagcdn.com/20x15/' + c.iso2 + '.png" alt="">' : "";
      li.innerHTML = flag + "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => { if (!quizAnswered) { locInput.value = ""; locResults.innerHTML = ""; handleGuess(c); } });
      locResults.appendChild(li);
    });
}

function renderNbResults(query: string): void {
  const q = query.trim().toLowerCase();
  nbResults.innerHTML = "";
  if (!q || !quizTarget) return;
  realCountries()
    .filter((c) => c !== quizTarget && !nbSelected.has(c) && c.name.toLowerCase().indexOf(q) !== -1)
    .slice(0, 8)
    .forEach((c) => {
      const li = document.createElement("li");
      const flag = c.iso2 ? '<img src="https://flagcdn.com/20x15/' + c.iso2 + '.png" alt="">' : "";
      li.innerHTML = flag + "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => addNbPick(c));
      nbResults.appendChild(li);
    });
}
function renderNbChips(): void {
  nbChips.innerHTML = "";
  nbSelected.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = c.name + " ";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.title = "Remove";
    x.addEventListener("click", () => { nbSelected.delete(c); renderNbChips(); refreshPolygons(); });
    chip.appendChild(x);
    nbChips.appendChild(chip);
  });
}
function addNbPick(c: CountryEntry): void {
  if (quizAnswered) return;
  nbSelected.add(c);
  nbInput.value = "";
  renderNbResults("");
  renderNbChips();
  refreshPolygons();
}
function toggleNbPick(c: CountryEntry): void {
  if (quizAnswered) return;
  if (nbSelected.has(c)) nbSelected.delete(c); else nbSelected.add(c);
  renderNbChips();
  refreshPolygons();
}
function nbCheckAnswers(): void {
  if (mode !== "quiz" || quizType !== "neighbour" || !quizTarget || quizAnswered) return;
  quizAnswered = true;
  quizTotal++;
  const missed = Array.from(quizNeighbourSet).filter((n) => !nbSelected.has(n));
  const wrong = Array.from(nbSelected).filter((p) => !quizNeighbourSet.has(p));
  const ok = missed.length === 0 && wrong.length === 0;
  if (ok) quizCorrect++;
  const total = quizNeighbourSet.size;
  let msg = (ok ? "✓ " : "✗ ") + "Found " + (total - missed.length) + " of " + total +
    " neighbours of " + quizTarget.name + ".";
  if (wrong.length) msg += " Wrong: " + wrong.map((w) => w.name).join(", ") + ".";
  if (missed.length) msg += " Missed: " + missed.map((m) => m.name).join(", ") + ".";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = msg;
  renderQuizScore();
  nbInput.disabled = true;
  nbCheck.disabled = true;
  quizNextBtn.disabled = false;
  refreshPolygons();
  // Reveal on the map: anchor (blue), all neighbours (green), wrong picks (red).
  quizLayer.clearLayers();
  const tc = layerCenter(quizTarget);
  if (tc) addQuizDot(quizTarget, tc, "target");
  quizNeighbourSet.forEach((n) => { const c = layerCenter(n); if (c) addQuizDot(n, c, "correct"); });
  wrong.forEach((w) => { const c = layerCenter(w); if (c) addQuizDot(w, c, "wrong"); });
  try {
    let b = quizTarget.layer.getBounds();
    quizNeighbourSet.forEach((n) => { try { b = b.extend(n.layer.getBounds()); } catch { /* ignore */ } });
    map.fitBounds(b, { maxZoom: 6, padding: [50, 50] });
  } catch { /* ignore */ }
}

function handleGuess(entry: CountryEntry): void {
  if (mode !== "quiz" || !quizTarget || quizAnswered || entry.isLandmass) return;
  quizGuess = entry;
  quizAnswered = true;
  quizTotal++;
  const ok = entry === quizTarget;
  quizLayer.clearLayers();
  const tCenter = layerCenter(quizTarget);
  if (ok) {
    quizCorrect++;
    quizFeedbackEl.className = "correct";
    quizFeedbackEl.textContent = "✓ Correct! It's " + quizTarget.name + ".";
    if (tCenter) addQuizDot(quizTarget, tCenter, "correct"); // labelled green dot
  } else {
    quizFeedbackEl.className = "wrong";
    quizFeedbackEl.innerHTML = "✗ That's " + escapeHtml(entry.name) +
      '. <a href="#" class="quiz-zoom">' + escapeHtml(quizTarget.name) + "</a> is the right one.";
    const z = quizFeedbackEl.querySelector(".quiz-zoom");
    if (z) z.addEventListener("click", (ev) => { ev.preventDefault(); zoomToTarget(8); });
    // Draw a line from the guess to the correct country (both labelled) so the
    // location is clear even for a tiny island. (No auto-zoom — use the link.)
    const gCenter = layerCenter(entry);
    if (gCenter && tCenter) {
      L.polyline([gCenter, tCenter], { color: "#8a3b00", weight: 2, opacity: 0.85, dashArray: "5 5" }).addTo(quizLayer);
      addQuizDot(quizTarget, tCenter, "correct");  // green: the right answer
      addQuizDot(entry, gCenter, "wrong");         // red: your guess
    }
  }
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true;
  locResults.innerHTML = "";
  refreshPolygons();
}

type DotKind = "correct" | "wrong" | "target";
const DOT_COLORS: Record<DotKind, { stroke: string; fill: string }> = {
  correct: { stroke: "#1b7a3d", fill: "#54c47e" },
  wrong: { stroke: "#9c1b12", fill: "#e8675c" },
  target: { stroke: "#1b3a5c", fill: "#3878c7" },
};
function addQuizDot(entry: CountryEntry, latlng: LatLng, kind: DotKind): void {
  // Always show flag + name on the dots once a guess is made.
  const flag = entry.iso2
    ? '<img class="quiz-dot-flag" src="https://flagcdn.com/24x18/' + entry.iso2 + '.png" alt=""> '
    : "";
  const col = DOT_COLORS[kind];
  // The answer is already revealed, so link the name to Wikipedia (interactive
  // tooltip) — handy for reading up on a country you just learned.
  const nameLink = '<a href="' + wikiUrl(entry.name) + '" target="_blank" rel="noopener">' +
    escapeHtml(entry.name) + "</a>";
  L.circleMarker(latlng, {
    radius: kind === "wrong" ? 5 : 6, color: col.stroke, weight: 2, fillColor: col.fill, fillOpacity: 1,
  }).bindTooltip(flag + nameLink, {
    permanent: true, direction: "top", interactive: true, className: "map-label quiz-label quiz-label-" + kind,
  }).addTo(quizLayer);
}

function zoomToTarget(maxZoom: number): void {
  if (!quizTarget) return;
  try { map.fitBounds(quizTarget.layer.getBounds(), { maxZoom, padding: [50, 50] }); } catch { /* ignore */ }
}
function setMode(m: "explore" | "quiz"): void {
  mode = m;
  document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  (document.getElementById("explore-panel") as HTMLElement).hidden = m !== "explore";
  (document.getElementById("quiz-panel") as HTMLElement).hidden = m !== "quiz";
  hideHoverInfo();
  if (m === "explore") {
    quizLayer.clearLayers();
    quizContLayer.clearLayers();
  } else {
    selectedLayer = null; selectedContinent = null; expandedContinent = null;
    if (!quizStarted) { quizStarted = true; quizCorrect = 0; quizTotal = 0; nextQuestion(); }
    renderQuizScore();
  }
  refreshAll();
}

// ---------------------------------------------------------------------------
// Wire UI + go
// ---------------------------------------------------------------------------
document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode as "explore" | "quiz"));
});
quizNextBtn.addEventListener("click", () => { if (mode === "quiz") nextQuestion(); });
quizSkipBtn.addEventListener("click", () => { if (mode === "quiz") nextQuestion(); });
nbInput.addEventListener("input", () => renderNbResults(nbInput.value));
nbCheck.addEventListener("click", nbCheckAnswers);
document.querySelectorAll<HTMLInputElement>('#nb-mode input[name="nbmode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    nbMode = r.value === "search" ? "search" : "map";
    applyNbMode();
    if (nbMode === "search") nbInput.focus();
  });
});
locInput.addEventListener("input", () => renderLocResults(locInput.value));
document.querySelectorAll<HTMLInputElement>('#loc-mode input[name="locmode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    locMode = r.value === "search" ? "search" : "map";
    applyLocMode();
    if (locMode === "search" && !quizAnswered) locInput.focus();
  });
});
document.querySelectorAll<HTMLElement>(".qt-btn").forEach((b) => {
  b.addEventListener("click", () => {
    quizType = b.dataset.qtype as QuizType;
    // Scope the active state to the button's own row (Country vs Mountains).
    b.parentElement!.querySelectorAll<HTMLElement>(".qt-btn").forEach((x) => x.classList.toggle("active", x === b));
    if (mode === "quiz") nextQuestion();
  });
});
// Top-level quiz category: "Country" (sub-types By name/flag/capital/Neighbour) or
// "Continent" (its own round — no sub-types).
const quizTypeEl = document.getElementById("quiz-type") as HTMLElement;
const mtnTypeEl = document.getElementById("mtn-type") as HTMLElement;
function setQuizCat(cat: "country" | "continent" | "mountains"): void {
  document.querySelectorAll<HTMLElement>(".qc-tab").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  quizTypeEl.hidden = cat !== "country";
  mtnTypeEl.hidden = cat !== "mountains";
  if (cat === "continent") {
    quizType = "continent";
  } else if (cat === "mountains") {
    const active = document.querySelector<HTMLElement>("#mtn-type .qt-btn.active");
    quizType = (active && (active.dataset.qtype as QuizType)) || "peakname";
  } else {
    const active = document.querySelector<HTMLElement>("#quiz-type .qt-btn.active");
    quizType = (active && (active.dataset.qtype as QuizType)) || "name";
  }
  if (mode === "quiz") nextQuestion();
}
document.querySelectorAll<HTMLElement>(".qc-tab").forEach((b) => {
  b.addEventListener("click", () => setQuizCat(b.dataset.cat as "country" | "continent" | "mountains"));
});

const capToggle = document.getElementById("show-capitals") as HTMLInputElement;
capToggle.addEventListener("change", () => { showCapitals = capToggle.checked; refreshCapitals(); });

const flagToggle = document.getElementById("show-flags") as HTMLInputElement;
flagToggle.addEventListener("change", () => { showFlags = flagToggle.checked; refreshFlags(); });

const mtnToggle = document.getElementById("show-mountains") as HTMLInputElement;
mtnToggle.addEventListener("change", () => { showPeaks = mtnToggle.checked; refreshPeaks(); });

const rivToggle = document.getElementById("show-rivers") as HTMLInputElement;
rivToggle.addEventListener("change", () => { showRivers = rivToggle.checked; refreshRivers(); });

const lakeToggle = document.getElementById("show-lakes") as HTMLInputElement;
lakeToggle.addEventListener("change", () => { showLakes = lakeToggle.checked; refreshLakes(); });

const nameToggle = document.getElementById("show-names") as HTMLInputElement;
nameToggle.addEventListener("change", () => { showNames = nameToggle.checked; refreshCountryLabels(); });


document.querySelectorAll<HTMLElement>(".sb-tab").forEach((btn) => {
  btn.addEventListener("click", () => { setActiveTab(btn.dataset.tab as "countries" | "continents"); setListExpanded(true); });
});
document.getElementById("list-fold")!.addEventListener("click", () => setListExpanded(!listExpanded));

let mapExpanded = true;
function setMapExpanded(on: boolean): void {
  mapExpanded = on;
  document.getElementById("map-group")!.classList.toggle("collapsed", !on);
}
document.querySelector(".sb-fold")!.addEventListener("click", () => setMapExpanded(!mapExpanded));

// Save space on small screens: start with both sections folded away.
setListExpanded(!isNarrow());
setMapExpanded(!isNarrow());

const searchInput = document.getElementById("search") as HTMLInputElement;
const searchClear = document.getElementById("search-clear") as HTMLButtonElement;
function syncSearchClear(): void { searchClear.hidden = searchInput.value === ""; }
searchInput.addEventListener("input", () => { applyFilter(); syncSearchClear(); });
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  applyFilter();
  syncSearchClear();
  searchInput.focus();
});

const sortSelect = document.getElementById("sort") as HTMLSelectElement;
sortSelect.addEventListener("change", () => {
  sortBy = sortSelect.value as "name" | "population" | "area";
  // Area needs the country dataset; load it first if sorting by area.
  if (sortBy === "area" && !countryData) loadCountryData().then(buildSidebar).catch(buildSidebar);
  else buildSidebar();
});

const schemeSelect = document.getElementById("scheme") as HTMLSelectElement;
schemeSelect.addEventListener("change", () => {
  groupScheme = schemeSelect.value as GroupScheme;
  // Group names differ per scheme, so any current region selection is stale.
  selectedContinent = null;
  expandedContinent = null;
  buildContinentList();
  refreshAll();
});

map.on("click", () => {        // background click clears selection
  if (suppressMapClick) return; // ignore the click that came from a country
  deselect();
});
map.on("zoomend", updateFlagSizes);
map.on("zoomend", updatePeakSizes);

// About / help modal.
const helpModal = document.getElementById("help-modal") as HTMLElement;
const openHelp = () => { helpModal.hidden = false; };
const closeHelp = () => { helpModal.hidden = true; };
document.querySelectorAll<HTMLElement>(".help-btn").forEach((b) => b.addEventListener("click", openHelp));
helpModal.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === helpModal || t.classList.contains("help-close")) closeHelp();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });

// Track the cursor so the hover info panel can float next to it.
map.getContainer().addEventListener("mousemove", (ev: MouseEvent) => {
  lastMouseX = ev.clientX;
  lastMouseY = ev.clientY;
  if (!hoverInfoEl.hidden) positionHoverInfo(lastMouseX, lastMouseY);
});

loadBorders();
