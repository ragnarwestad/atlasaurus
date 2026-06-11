import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import {
  BORDER_URLS, CAPITAL_URLS, SUBUNIT_URLS,
  baseStyle, hoverStyle, selectedStyle, relatedStyle, continentStyle, hiddenStyle,
  CONNECTOR_MIN_AREA, CONNECTOR_MAX_LINES, SUBUNIT_MATCH_MAX_D2,
} from "./config";
import { allPolygonParts, centerOf, type LatLng } from "./geo";
import { wikiUrl, cityWikiUrl, escapeHtml } from "./wiki";

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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const countries: CountryEntry[] = [];
const capitalMarkers: CapitalMarker[] = [];
const subunitsByIso: Record<string, Subunit[]> = {};
const territoriesBySov: Record<string, Territory[]> = {};

let selectedLayer: L.Polygon | null = null;
let selectedContinent: string | null = null;
let hoveredLayer: L.Polygon | null = null;
let showNames = false;
let showCapitals = false;
let showFlags = false;
let isolate = false;
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
  // A selected continent takes precedence: keep showing all its members (the
  // selected country, if any, is one of them).
  if (isolate && selectedContinent) return (e.continent || "Other") === selectedContinent;
  if (isolate && selectedLayer) return e.layer === selectedLayer || sameRealm(e);
  return true;
}

// Scope of the "Show names/capitals/flags" toggles:
//  - Countries tab: global (all countries).
//  - Continents tab: only the selected continent's members (nothing if none).
function inToggleScope(e: CountryEntry): boolean {
  if (activeTab === "continents") return selectedContinent != null && (e.continent || "Other") === selectedContinent;
  return true;
}

function refreshCountryLabels(): void {
  countries.forEach((e) => {
    if (!e.labelTooltip) return;
    const el = e.labelTooltip.getElement();
    if (el) el.style.display = countryVisible(e) && ((showNames && inToggleScope(e)) || isRevealed(e)) ? "" : "none";
  });
}

function refreshCapitals(): void {
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
interface RestInfo { area?: number; currencies?: string; languages?: string; continent?: string; }
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
      map[c.cca3] = { area: c.area, currencies, languages, continent };
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
  if (entry && entry.capitalName) rows.push(["Capital", escapeHtml(entry.capitalName)]);
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
}

// Bottom panel shows the selected COUNTRY, or the selected CONTINENT, or nothing.
function updateInfoPanel(): void {
  if (selectedLayer) { renderCountryInfo(); return; }
  if (selectedContinent) { renderContinentInfo(selectedContinent); return; }
  countryInfoEl.hidden = true;
  currentInfoCode = null;
  currentInfoContinent = null;
}

function renderCountryInfo(): void {
  currentInfoContinent = null;
  const props = ((selectedLayer as any).feature && (selectedLayer as any).feature.properties) || {};
  const entry = entryForLayer(selectedLayer);
  const code: string | null = props.ADM0_A3 || props.adm0_a3 || null;
  currentInfoCode = code;
  const conn = selectedLayer ? computeConnectors(selectedLayer) : null;
  const territories = conn ? conn.items.map((i) => i.name).sort((a, b) => a.localeCompare(b)) : [];
  renderInfo(props, entry, (countryData && code) ? countryData[code] || null : null, territories);

  // Lazy-load area/currency/languages the first time, then re-render.
  if (!countryData) {
    loadCountryData().then((map) => {
      if (currentInfoCode === code && selectedLayer) renderInfo(props, entry, code ? map[code] || null : null, territories);
    }).catch(() => { /* extra fields optional */ });
  }
}

function renderContinentInfo(name: string): void {
  currentInfoCode = null;
  currentInfoContinent = name;
  const members = countries.filter((e) => (e.continent || "Other") === name && !e.isLandmass);
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
  const titleLink = name !== "Other"
    ? '<a href="' + wikiUrl(name) + '" target="_blank" rel="noopener">' + escapeHtml(name) + ' <span class="ext">↗</span></a>'
    : escapeHtml(name);
  countryInfoEl.innerHTML =
    '<div class="ci-head"><div><div class="ci-title">' + titleLink + "</div>" +
    '<div class="ci-sub">Continent</div></div>' +
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
  // Hidden in isolate mode: continent context wins (hide non-members); else the
  // single-country context (hide everything but it and its realm siblings).
  if (isolate && selectedContinent) {
    if ((e.continent || "Other") !== selectedContinent) return null;
  } else if (isolate && selectedLayer && e.layer !== selectedLayer && !sameRealm(e)) {
    return null;
  }
  if (e.layer === selectedLayer) return selectedStyle;                                   // selected country (orange)
  if (selectedContinent && (e.continent || "Other") === selectedContinent) return continentStyle; // continent member (green)
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
// Refresh pipeline + selection
// ---------------------------------------------------------------------------
function refreshAll(): void {
  refreshPolygons();
  refreshConnectors();
  refreshCountryLabels();
  refreshCapitals();
  refreshFlags();
  updateInfoPanel();
  markActiveContinent();
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
      if ((e.continent || "Other") !== selectedContinent) return;
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
let expandedContinent: string | null = null; // which continent's countries are shown in the Continents tab
let sortBy: "name" | "population" | "area" = "name";

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
  const counts: Record<string, number> = {};
  const byCont: Record<string, CountryEntry[]> = {};
  countries.forEach((e) => {
    const g = e.continent || "Other";
    if (e.isLandmass) { counts[g] = counts[g] || 0; return; } // list the continent, 0 countries
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
    head.innerHTML = '<span class="cont-name"><span class="caret">▾</span> ' + escapeHtml(g) +
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
  document.querySelectorAll<HTMLElement>(".sb-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const countries$ = tab === "countries";
  (document.getElementById("country-list") as HTMLElement).hidden = !countries$;
  (document.getElementById("continent-list") as HTMLElement).hidden = countries$;
  (document.getElementById("search") as HTMLElement).style.display = countries$ ? "" : "none";
  // The toggles' scope depends on the active tab, so re-evaluate the reveals.
  refreshCountryLabels();
  refreshCapitals();
  refreshFlags();
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
        layerP.on({
          // Hover only restyles the polygon and shows the off-map info panel —
          // no on-map labels, no bringToFront — so it can never cancel a click.
          mouseover: () => { hoveredLayer = layerP; refreshPolygons(); showHoverInfo(entry); },
          mouseout: () => { if (hoveredLayer === layerP) hoveredLayer = null; refreshPolygons(); hideHoverInfo(); },
          click: (e) => {
            L.DomEvent.stop(e);
            suppressMapClick = true;
            setTimeout(() => { suppressMapClick = false; }, 0);
            // The Antarctica landmass selects its continent, not a "country".
            if (isLandmass) selectContinent(continent); else selectLayer(layerP, true);
          },
        });
      },
    }).addTo(map);

    (map as any).borderLayer = layer;
    buildSidebar();
    setActiveTab("countries");
    placeCountryLabels();

    // Natural Earth leaves some ocean island states without a continent
    // ("Seven seas (open ocean)" → "Other"). Reassign continents from the
    // authoritative mledoze dataset so every country lands in one of the seven.
    loadCountryData().then((data) => {
      let changed = false;
      countries.forEach((e) => {
        if (e.isLandmass || !e.iso) return;
        const d = data[e.iso];
        if (d && d.continent && d.continent !== e.continent) { e.continent = d.continent; changed = true; }
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
// Wire UI + go
// ---------------------------------------------------------------------------
const capToggle = document.getElementById("show-capitals") as HTMLInputElement;
capToggle.addEventListener("change", () => { showCapitals = capToggle.checked; refreshCapitals(); });

const flagToggle = document.getElementById("show-flags") as HTMLInputElement;
flagToggle.addEventListener("change", () => { showFlags = flagToggle.checked; refreshFlags(); });

const nameToggle = document.getElementById("show-names") as HTMLInputElement;
nameToggle.addEventListener("change", () => { showNames = nameToggle.checked; refreshCountryLabels(); });

const isoToggle = document.getElementById("isolate") as HTMLInputElement;
isoToggle.addEventListener("change", () => { isolate = isoToggle.checked; refreshAll(); });

document.querySelectorAll<HTMLElement>(".sb-tab").forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab((btn.dataset.tab as "countries" | "continents")));
});

const searchInput = document.getElementById("search") as HTMLInputElement;
searchInput.addEventListener("input", applyFilter);

const sortSelect = document.getElementById("sort") as HTMLSelectElement;
sortSelect.addEventListener("change", () => {
  sortBy = sortSelect.value as "name" | "population" | "area";
  // Area needs the country dataset; load it first if sorting by area.
  if (sortBy === "area" && !countryData) loadCountryData().then(buildSidebar).catch(buildSidebar);
  else buildSidebar();
});

map.on("click", () => {        // background click clears selection
  if (suppressMapClick) return; // ignore the click that came from a country
  deselect();
});
map.on("zoomend", updateFlagSizes);

// Track the cursor so the hover info panel can float next to it.
map.getContainer().addEventListener("mousemove", (ev: MouseEvent) => {
  lastMouseX = ev.clientX;
  lastMouseY = ev.clientY;
  if (!hoverInfoEl.hidden) positionHoverInfo(lastMouseX, lastMouseY);
});

loadBorders();
