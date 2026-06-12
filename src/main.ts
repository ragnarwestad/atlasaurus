import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import {
  BORDER_URLS, CAPITAL_URLS, SUBUNIT_URLS, RIVER_URLS, LAKE_URLS, CITY_URLS,
  baseStyle, hoverStyle, selectedStyle, relatedStyle, continentStyle, hiddenStyle,
  quizCorrectStyle, quizWrongStyle,
  CONNECTOR_MIN_AREA, CONNECTOR_MAX_LINES, SUBUNIT_MATCH_MAX_D2,
} from "./config";
import { allPolygonParts, centerOf, type LatLng } from "./geo";
import { wikiUrl, cityWikiUrl, escapeHtml } from "./wiki";
import { PEAKS, type Peak } from "./peaks";
import {
  map, capitalLayer, connectorLayer, flagLayer, peakLayer, riverLayer, lakeLayer,
  cityLayer, cityLabelLayer, cityCanvas, quizLayer, quizContLayer, regionLabelLayer,
} from "./map";
import {
  app, hooks, countries, byIso, capitalMarkers, subunitsByIso, territoriesBySov,
  CONTINENT_ORDER, fmtInt, fetchJson, realCountries, entryForLayer, popOf, areaOf,
  layerCenter, loadCountryData,
  type CountryEntry, type CapitalMarker, type Territory, type Subunit,
  type RestInfo, type GroupScheme, type QuizType,
} from "./state";
import {
  trackMouse, showHoverInfo, hideHoverInfo, countryInfoEl, renderFeatureInfo,
  attachLabelClick, updateInfoPanel, isNarrow,
} from "./panel";
import {
  refreshCountryLabels, refreshFlags, updateFlagSizes, placeCountryLabels, updatePeakLabels,
} from "./labels";
import {
  peakIcon, refreshPeaks, refreshRivers, refreshLakes, updatePeakSizes, peakCountryNames,
} from "./physical";

// ---------------------------------------------------------------------------
// Status line (loading / error)
// ---------------------------------------------------------------------------
const statusEl = document.getElementById("status");
const setStatus = (msg: string) => { if (statusEl) statusEl.textContent = msg; };
const hideStatus = () => { if (statusEl) statusEl.remove(); };

// Region grouping: non-continent schemes read straight from the Natural
// Earth feature properties we already load (REGION_UN / SUBREGION / REGION_WB).
const SCHEME_PROP: Record<Exclude<GroupScheme, "continent">, string> = {
  unRegion: "REGION_UN", subregion: "SUBREGION", wbRegion: "REGION_WB",
};
export const SCHEME_LABEL: Record<GroupScheme, string> = {
  continent: "Continent", unRegion: "UN region", subregion: "UN subregion", wbRegion: "World Bank region",
};
export function groupOf(e: CountryEntry): string {
  if (app.groupScheme === "continent") return e.continent || "Other";
  const p = (e.layer.feature && e.layer.feature.properties) || {};
  const v = p[SCHEME_PROP[app.groupScheme]];
  return (v != null && String(v).trim()) ? String(v).trim() : "Other";
}
// Distinct hue per region for the Regions-tab map tint (spread around the wheel).
function rebuildRegionColors(): void {
  const groups = Array.from(new Set(realCountries().map(groupOf))).filter((g) => g !== "Other").sort();
  app.regionHue = {};
  const n = groups.length || 1;
  groups.forEach((g, i) => { app.regionHue[g] = Math.round((360 * i) / n); });
}

// ---------------------------------------------------------------------------
// Visibility / styling helpers
// ---------------------------------------------------------------------------
function sovOf(layer: any): string | null {
  const p = (layer && layer.feature && layer.feature.properties) || {};
  return p.SOV_A3 || p.sov_a3 || null;
}
/** Same sovereign state (e.g. Denmark ↔ Greenland/Faroe), different unit. */
function sameRealm(e: CountryEntry): boolean {
  if (!app.selectedLayer || e.layer === app.selectedLayer) return false;
  const s = sovOf(app.selectedLayer), x = sovOf(e.layer);
  return !!s && s === x;
}
// Reveal = country selected (or a realm sibling). On-map labels/capitals/flags
// are shown for these (and via the toggles) — NOT on hover. Hover info goes to a
// separate off-map panel (see showHoverInfo) so it can't fight the polygon's
// hover/click and cause flicker. On-map labels stay interactive (clickable).
export function isRevealed(e: CountryEntry): boolean {
  return e.layer === app.selectedLayer || sameRealm(e);
}
export function countryVisible(e: CountryEntry): boolean {
  if (app.mode === "quiz") return true; // everything visible/clickable in the quiz
  // A selected continent takes precedence: keep showing all its members (the
  // selected country, if any, is one of them).
  if (app.isolate && app.selectedContinent) return groupOf(e) === app.selectedContinent;
  if (app.isolate && app.selectedLayer) return e.layer === app.selectedLayer || sameRealm(e);
  return true;
}

// Scope of the "Show names/capitals/flags" toggles:
//  - Countries tab: global (all countries).
//  - Continents tab: only the selected continent's members (nothing if none).
export function inToggleScope(e: CountryEntry): boolean {
  if (app.activeTab === "continents") return app.selectedContinent != null && groupOf(e) === app.selectedContinent;
  return true;
}

const CAPITAL_MAX = 70; // ceiling on capitals shown per view (grows with zoom)
function refreshCapitals(): void {
  if (app.mode === "quiz") { capitalMarkers.forEach((m) => { if (capitalLayer.hasLayer(m)) capitalLayer.removeLayer(m); }); return; }
  const z = map.getZoom();
  const cap = Math.max(8, Math.min(CAPITAL_MAX, Math.round((z - 1) * 12)));
  const b = map.getBounds().pad(0.15);
  // Capitals allowed by the toggle + tab scope (the selected region on the Regions tab).
  const eligible = capitalMarkers.filter((m) => {
    const e = m._entry;
    const cv = e ? countryVisible(e) : !(app.isolate && app.selectedLayer);
    const byToggle = e ? (app.showCapitals && inToggleScope(e)) : (app.showCapitals && app.activeTab === "countries");
    return cv && byToggle;
  });
  // Of those, show only the in-view ones, ranked by country population and capped
  // by zoom — so big countries' capitals appear first, more as you zoom in.
  const shown = new Set<CapitalMarker>(
    eligible
      .filter((m) => b.contains(m.getLatLng()))
      .sort((a, c) => (c._entry ? popOf(c._entry) : 0) - (a._entry ? popOf(a._entry) : 0))
      .slice(0, cap),
  );
  // The selected country's capital is always shown, regardless of zoom/cap.
  capitalMarkers.forEach((m) => { const e = m._entry; if (e && isRevealed(e) && countryVisible(e)) shown.add(m); });
  capitalMarkers.forEach((m) => {
    const has = capitalLayer.hasLayer(m);
    if (shown.has(m) && !has) capitalLayer.addLayer(m);
    else if (!shown.has(m) && has) capitalLayer.removeLayer(m);
  });
}

function styleForLayer(e: CountryEntry): L.PathOptions | null {
  if (app.mode === "quiz") {
    if (app.quizAnswered) {
      if (app.quizType === "continent") {
        const cont = e.continent || "Other";
        if (app.quizContCorrect && cont === app.quizContCorrect) return quizCorrectStyle; // correct continent (green)
        if (app.quizContWrong && cont === app.quizContWrong) return quizWrongStyle;       // guessed continent (red)
        return baseStyle; // answered → no per-country hover in continent quiz
      } else if (app.quizType === "neighbour") {
        if (e === app.quizTarget) return selectedStyle;          // the anchor country (orange)
        if (app.quizNeighbourSet.has(e)) return quizCorrectStyle; // its neighbours (green)
        if (app.nbSelected.has(e)) return quizWrongStyle;        // a wrong pick (red)
        return baseStyle; // answered → no per-country hover
      } else if (app.quizType === "peakcountry") {
        if (app.quizPeak && e.iso && app.quizPeak.iso.includes(e.iso)) return quizCorrectStyle; // the peak's country (green)
        if (app.quizGuess && e === app.quizGuess) return quizWrongStyle;                          // wrong pick (red)
        return baseStyle;
      } else if (app.quizType === "peakname") {
        return baseStyle; // answer shown on the marker, not the countries
      } else {
        if (e === app.quizTarget) return quizCorrectStyle;                       // the right answer (green)
        if (app.quizGuess && e === app.quizGuess && app.quizGuess !== app.quizTarget) return quizWrongStyle; // wrong guess (red)
      }
    } else if (app.quizType === "continent") {
      // Tint each continent so the clickable regions are obvious; hovering any
      // country deepens the shade of its WHOLE continent.
      const st = CONTINENT_QUIZ_STYLES[e.continent || "Other"];
      if (st) {
        const hot = app.hoveredContinent && (e.continent || "Other") === app.hoveredContinent;
        return hot ? { ...st, fillOpacity: 0.82, weight: 1.5 } : st;
      }
    } else if (app.quizType === "neighbour" && app.nbSelected.has(e)) {
      return relatedStyle; // your current picks (before checking)
    } else if (app.quizType === "spot" && e === app.quizTarget) {
      return selectedStyle; // the country to name (orange highlight + pin)
    }
    if (e.layer === app.hoveredLayer) return hoverStyle;
    return baseStyle;
  }
  // Hidden in isolate mode: continent context wins (hide non-members); else the
  // single-country context (hide everything but it and its realm siblings).
  if (app.isolate && app.selectedContinent) {
    if (groupOf(e) !== app.selectedContinent) return null;
  } else if (app.isolate && app.selectedLayer && e.layer !== app.selectedLayer && !sameRealm(e)) {
    return null;
  }
  if (e.layer === app.selectedLayer) return selectedStyle;                                   // selected country (orange)
  // Regions tab: tint every country by its region (distinct hue), like the
  // continent quiz. The selected region and the hovered region get a deeper fill.
  if (app.activeTab === "continents") {
    const hue = app.regionHue[groupOf(e)];
    if (hue != null) {
      const sel = app.selectedContinent === groupOf(e);
      const hot = !sel && app.hoveredContinent === groupOf(e);
      return {
        color: "hsl(" + hue + ", 55%, 38%)", weight: sel ? 1.8 : hot ? 1.3 : 1, opacity: 1,
        fillColor: "hsl(" + hue + ", 60%, 62%)", fillOpacity: sel ? 0.72 : hot ? 0.6 : 0.45,
      };
    }
  }
  if (app.selectedContinent && groupOf(e) === app.selectedContinent) return continentStyle; // region member (green)
  if (sameRealm(e)) return relatedStyle;
  if (e.layer === app.hoveredLayer) return hoverStyle;
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
export function computeConnectors(layer: L.Polygon): { home: LatLng; items: Connector[] } | null {
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
  if (!app.selectedLayer) return; // lines show on selection, isolate or not
  const c = computeConnectors(app.selectedLayer);
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

// --- Cities (Explore "Cities" layer) — the 10m populated-places set (~7k). To
//     keep zooming smooth we keep the raw data and, on each view change, render
//     only the in-view cities above the zoom's min_zoom — capped, with DOM name
//     labels only for the top few. (Thousands of permanent labels = big lag.) ---
const CITY_ZOOM_BIAS = 1;  // reveal cities a level earlier than their nominal min_zoom
const CITY_MAX = 70;       // ceiling on cities rendered per view (each gets a dot AND a label)
interface CityRec { lat: number; lng: number; name: string; mz: number; cap: boolean; pop: number; adm0: string; adm1: string; elev: number; }
let cityData: CityRec[] = [];
let cityDataLoaded = false;
let citiesLoading = false;
// The zoom at/above which a place should appear: prefer NE's min_zoom, fall back
// to scalerank, then to a population-based guess.
function placeMinZoom(p: any): number {
  if (p.min_zoom != null) return +p.min_zoom;
  if (p.scalerank != null) return +p.scalerank;
  const pop = +(p.pop_max || 0);
  return pop > 5e6 ? 1 : pop > 1e6 ? 3 : pop > 2e5 ? 5 : 7;
}
function loadCities(): void {
  if (cityDataLoaded || citiesLoading) return;
  citiesLoading = true;
  fetchJson(CITY_URLS).then((geo) => {
    cityData = (((geo.features || []) as any[]).map((f) => {
      const p = f.properties || {};
      const c = f.geometry && f.geometry.coordinates;
      const name = p.name || p.nameascii;
      if (!c || !name) return null;
      const cap = String(p.featurecla || "").toLowerCase().indexOf("admin-0 capital") !== -1;
      return {
        lat: c[1], lng: c[0], name, mz: placeMinZoom(p), cap,
        pop: +(p.pop_max || p.pop_min || 0),
        adm0: p.adm0name || p.adm0_name || "",
        adm1: p.adm1name || p.adm1_name || "",
        elev: +(p.elevation || p.ELEVATION || 0),
      } as CityRec;
    }).filter(Boolean)) as CityRec[];
    cityDataLoaded = true; citiesLoading = false;
    updateCities();
  }).catch(() => { citiesLoading = false; });
}
function updateCities(): void {
  if (!(app.showCities && app.mode === "explore")) { cityLayer.clearLayers(); cityLabelLayer.clearLayers(); return; }
  if (!cityDataLoaded) { loadCities(); return; }
  cityLayer.clearLayers();
  cityLabelLayer.clearLayers();
  const zReal = map.getZoom();
  const z = zReal + CITY_ZOOM_BIAS;
  // Show only a few (biggest) cities when zoomed out, more as you zoom in.
  const cap = Math.max(8, Math.min(CITY_MAX, Math.round((zReal - 1) * 12)));
  const b = map.getBounds().pad(0.15);
  const vis = cityData.filter((d) => d.mz <= z && b.contains([d.lat, d.lng])).sort((a, c) => a.mz - c.mz).slice(0, cap);
  vis.forEach((d) => {
    // Capitals get the red ring (matching the Capitals layer) so they stay easy to
    // tell apart even when both layers are on, regardless of draw order.
    const style = d.cap
      ? { renderer: cityCanvas, radius: 4, color: "#b3261e", weight: 1.5, fillColor: "#fff", fillOpacity: 1 }
      : { renderer: cityCanvas, radius: 3, color: "#444", weight: 1, fillColor: "#fff", fillOpacity: 1 };
    const open = () => {
      const sub = d.cap ? (d.adm0 ? "Capital of " + d.adm0 : "Capital") : (d.adm0 ? "City in " + d.adm0 : "City");
      const rows: [string, string][] = [];
      if (d.adm1 && d.adm1 !== d.adm0) rows.push(["Region", escapeHtml(d.adm1)]);
      if (d.pop) rows.push(["Population", fmtInt(d.pop)]);
      if (d.elev) rows.push(["Elevation", fmtInt(d.elev) + " m"]);
      renderFeatureInfo(d.name, cityWikiUrl(d.name), sub, rows);
    };
    L.circleMarker([d.lat, d.lng], style).addTo(cityLayer).on("click", (ev) => {
      L.DomEvent.stop(ev); app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0); open();
    });
    const tt = L.tooltip({ permanent: true, direction: "right", offset: [5, 0], interactive: false, className: "map-label " + (d.cap ? "capital-label" : "city-label") })
      .setLatLng([d.lat, d.lng])
      .setContent(escapeHtml(d.name))
      .addTo(cityLabelLayer);
    attachLabelClick(tt, open);
  });
}
let cityUpdateScheduled = false;
function scheduleCityUpdate(): void {
  if (cityUpdateScheduled) return;
  cityUpdateScheduled = true;
  requestAnimationFrame(() => { cityUpdateScheduled = false; updateCities(); });
}
function refreshCities(): void { updateCities(); }
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
  refreshCities();
  updateInfoPanel();
  markActiveContinent();
  updateRegionLabels();
}
hooks.refreshAll = refreshAll; // modules trigger full refreshes via this hook

/** Single-country selection; toggle=true (map click) deselects the same country.
 *  A selected continent is kept, so picking a country inside it keeps the
 *  continent highlighted (green) with the country shown selected (orange). */
function selectLayer(layer: L.Polygon, toggle: boolean): void {
  app.selectedLayer = toggle && app.selectedLayer === layer ? null : layer;
  if (app.selectedLayer) app.selectedLayer.bringToFront();
  refreshAll();
}
export function deselect(): void {
  if (app.selectedLayer || app.selectedContinent) { app.selectedLayer = null; app.selectedContinent = null; refreshAll(); }
}

// Select a whole continent: highlight all member countries and show aggregate
// info. Clicking the active continent again clears it. (Mutually exclusive with
// single-country selection.)
function selectContinent(name: string): void {
  app.selectedLayer = null;
  app.selectedContinent = app.selectedContinent === name ? null : name;
  if (app.selectedContinent) {
    let b: L.LatLngBounds | null = null;
    countries.forEach((e) => {
      if (groupOf(e) !== app.selectedContinent) return;
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
let listExpanded = true; // the Countries/Continents list section is foldable

// Single source of truth for what the list section shows, given the active tab
// and whether the section is expanded. Collapsing hides the filter row + lists.
function updateListVisibility(): void {
  const countries$ = app.activeTab === "countries";
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

// Compact value with 2 decimals + magnitude suffix, e.g. 1.41B, 5.43M, 323.80K.
function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
// The value shown in parentheses for the current sort (empty when sorting by name).
function metricLabel(value: number): string {
  if (app.sortBy === "population") return " (" + formatCompact(value) + ")";
  if (app.sortBy === "area") return " (" + formatCompact(value) + " km²)";
  return "";
}

// Comparator for the current sort: population/area descending, else A–Z.
function cmpCountries(a: CountryEntry, b: CountryEntry): number {
  if (app.sortBy === "population") return popOf(b) - popOf(a) || a.name.localeCompare(b.name);
  if (app.sortBy === "area") return areaOf(b) - areaOf(a) || a.name.localeCompare(b.name);
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
  if (app.sortBy !== "name") {
    const m = document.createElement("span");
    m.className = "metric";
    m.textContent = metricLabel(app.sortBy === "population" ? popOf(entry) : areaOf(entry));
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
    h.classList.toggle("active", h.dataset.group === app.selectedContinent);
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
  if (app.sortBy === "name") {
    order.sort((a, b) => {
      const ia = CONTINENT_ORDER.indexOf(a), ib = CONTINENT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  } else {
    // Sort continents by total population / area of their members (descending).
    const metric = (g: string) => (byCont[g] || []).reduce((s, e) => s + (app.sortBy === "population" ? popOf(e) : areaOf(e)), 0);
    order.sort((a, b) => metric(b) - metric(a) || a.localeCompare(b));
  }

  const cl = document.getElementById("continent-list")!;
  cl.innerHTML = "";
  order.forEach((g) => {
    const head = document.createElement("li");
    head.className = "cont-head" + (app.expandedContinent === g ? " expanded" : "") +
      (app.selectedContinent === g ? " active" : "");
    head.dataset.group = g;
    head.title = "Show all of " + g + " on the map";
    const total = app.sortBy === "name" ? 0
      : (byCont[g] || []).reduce((s, e) => s + (app.sortBy === "population" ? popOf(e) : areaOf(e)), 0);
    const metric = app.sortBy === "name" ? "" : '<span class="metric">' + metricLabel(total) + "</span>";
    const hue = app.regionHue[g];
    const sw = hue != null ? '<span class="cont-swatch" style="background:hsl(' + hue + ',60%,62%)"></span>' : "";
    head.innerHTML = '<span class="cont-name"><span class="caret">▾</span>' + sw + escapeHtml(g) + metric +
      '</span><span class="cnt">' + counts[g] + "</span>";
    head.addEventListener("click", () => {
      if (app.expandedContinent === g) { app.expandedContinent = null; deselect(); }
      else { app.expandedContinent = g; selectContinent(g); }
      buildContinentList();
    });
    cl.appendChild(head);

    if (app.expandedContinent === g) {
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
  app.activeTab = tab;
  // Each tab owns its selection type — clear the other tab's selection so a
  // continent highlight doesn't linger on the Countries tab (and vice versa).
  if (tab === "countries") { app.selectedContinent = null; app.expandedContinent = null; }
  else { app.selectedLayer = null; }

  document.querySelectorAll<HTMLElement>(".sb-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  updateListVisibility();

  buildContinentList(); // reflect cleared expand/selection state
  refreshAll();         // restyle map, panels, reveals (toggle scope depends on tab)
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
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
      marker.bindTooltip(escapeHtml(capName), {
        permanent: true, interactive: false, direction: "right", offset: [6, 0],
        className: "map-label capital-label", opacity: 1,
      });

      const e = (cIso && entryByIso[cIso]) || entryByName[cCountry] || null;
      marker._entry = e;
      if (e) { e.capitalMarker = marker; e.capitalName = capName; }
      const cName = p.adm0name || (e ? e.name : "");
      const adm1 = p.adm1name || "";
      const elev = +(p.elevation || 0);
      const pop = +(p.pop_max || p.pop_min || 0);
      const open = () => {
        const rows: [string, string][] = [];
        if (adm1) rows.push(["Region", escapeHtml(adm1)]);
        if (pop) rows.push(["Population", fmtInt(pop)]);
        if (elev) rows.push(["Elevation", fmtInt(elev) + " m"]);
        renderFeatureInfo(capName, cityWikiUrl(capName), cName ? "Capital of " + cName : "Capital", rows);
      };
      marker.on("click", (ev) => { L.DomEvent.stop(ev); app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0); open(); });
      marker.on("tooltipopen", (ev: any) => attachLabelClick(ev.tooltip, open));
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
            app.hoveredLayer = layerP;
            app.hoveredContinent = app.mode === "quiz" ? (entry.continent || "Other") : groupOf(entry);
            refreshPolygons();
            // The selected country already shows its flag + name on the map and in
            // the fact panel, so skip the redundant hover tooltip for it.
            if (app.mode === "explore") { if (layerP === app.selectedLayer || !app.showHover) hideHoverInfo(); else showHoverInfo(entry); }
          },
          mouseout: () => { if (app.hoveredLayer === layerP) { app.hoveredLayer = null; app.hoveredContinent = null; } refreshPolygons(); if (app.mode === "explore") hideHoverInfo(); },
          click: (e) => {
            L.DomEvent.stop(e);
            app.suppressMapClick = true;
            setTimeout(() => { app.suppressMapClick = false; }, 0);
            if (app.mode === "quiz") {
              if (app.quizType === "continent") { if (!entry.isLandmass) answerContinent(entry.continent || "Other"); }
              else if (app.quizType === "neighbour") { if (app.nbMode === "map" && !entry.isLandmass && entry !== app.quizTarget) toggleNbPick(entry); }
              else if (app.quizType === "peakcountry") { if (!entry.isLandmass) handlePeakCountryGuess(entry); }
              else if (app.quizType === "peakname") { /* answered via the choice buttons */ }
              else { if (app.locMode === "map") handleGuess(entry); }
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
  if (app.quizType === "peakname") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">peak</span> <span>Which mountain?</span>';
    return;
  }
  if (app.quizType === "peakcountry") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">peak</span> <span>' + escapeHtml(app.quizPeak ? app.quizPeak.name : "") + "</span>";
    return;
  }
  if (!app.quizTarget) { quizPromptEl.innerHTML = ""; return; }
  if (app.quizType === "flag") {
    // Flag quiz: show only the flag (no name) — identify it and click it.
    quizPromptEl.innerHTML = app.quizTarget.iso2
      ? '<img class="quiz-bigflag" src="https://flagcdn.com/96x72/' + app.quizTarget.iso2 + '.png" alt="Flag">'
      : "(no flag available)";
  } else if (app.quizType === "capital") {
    // Capital quiz: show the capital city; click its country.
    quizPromptEl.innerHTML = app.quizTarget.capitalName
      ? '<span class="quiz-cap-tag">capital</span> <span>' + escapeHtml(app.quizTarget.capitalName) + "</span>"
      : "(no capital)";
  } else if (app.quizType === "continent" || app.quizType === "neighbour") {
    // Show the country (flag + name); pick its continent / click a neighbour.
    const flag = app.quizTarget.iso2 ? '<img src="https://flagcdn.com/40x30/' + app.quizTarget.iso2 + '.png" alt="">' : "";
    quizPromptEl.innerHTML = flag + "<span>" + escapeHtml(app.quizTarget.name) + "</span>";
  } else if (app.quizType === "spot") {
    // Spot quiz: the country is highlighted/pinned on the map — naming it is the
    // task, so the prompt must NOT reveal the name.
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">pinned</span> <span>Which country?</span>';
  } else {
    // Name quiz: just the name (no flag — that would give it away).
    quizPromptEl.innerHTML = "<span>" + escapeHtml(app.quizTarget.name) + "</span>";
  }
}
function renderQuizScore(): void {
  quizScoreEl.textContent = app.quizTotal ? "Score: " + app.quizCorrect + " / " + app.quizTotal : "";
}
// Neighbouring countries (mledoze `borders`, resolved to entries we have).
function neighbourEntries(entry: CountryEntry): CountryEntry[] {
  const codes = (app.countryData && entry.iso && app.countryData[entry.iso] && app.countryData[entry.iso].borders) || [];
  return codes.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
}

function nextQuestion(): void {
  // The neighbour quiz needs the borders dataset; load it first if necessary.
  if (app.quizType === "neighbour" && !app.countryData) {
    loadCountryData().then(() => nextQuestion()).catch(() => { /* ignore */ });
    return;
  }
  if (app.quizType === "peakname" || app.quizType === "peakcountry") { nextPeakQuestion(); return; }
  // Restrict the pool to countries that have what the prompt needs.
  const pool = app.quizType === "flag" ? realCountries().filter((c) => c.iso2)
    : app.quizType === "capital" ? realCountries().filter((c) => c.capitalName)
    : app.quizType === "neighbour" ? realCountries().filter((c) => neighbourEntries(c).length > 0)
    : realCountries();
  if (!pool.length) return;
  let t = app.quizTarget;
  for (let i = 0; i < 20 && (!t || t === app.quizTarget); i++) t = pool[Math.floor(Math.random() * pool.length)];
  app.quizTarget = t;
  app.quizGuess = null;
  app.quizAnswered = false;
  app.quizContCorrect = null;
  app.quizContWrong = null;
  app.quizNeighbourSet = app.quizType === "neighbour" && t ? new Set(neighbourEntries(t)) : new Set();
  quizLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (app.quizType === "continent") {
    showContinentLabels();
    quizChoicesEl.hidden = true;
    nbBox.hidden = true;
    locBox.hidden = true;
    quizFeedbackEl.textContent = "Click any country in its continent on the map.";
  } else if (app.quizType === "neighbour") {
    quizChoicesEl.hidden = true;
    locBox.hidden = true;
    quizContLayer.clearLayers();
    app.nbSelected = new Set();
    nbInput.value = ""; nbInput.disabled = false;
    nbResults.innerHTML = "";
    renderNbChips();
    nbCheck.disabled = false;
    nbBox.hidden = false;
    applyNbMode();
  } else if (app.quizType === "spot") {
    // Spot: highlight + drop a pin on a random country; the user names it by
    // search. Reset to the world view so the pin is always on screen.
    quizChoicesEl.hidden = true;
    quizContLayer.clearLayers();
    nbBox.hidden = true;
    locInput.value = ""; locInput.disabled = false;
    locResults.innerHTML = "";
    locBox.hidden = false;
    locModeEl.hidden = true;     // always answered by typing the name
    app.locMode = "search";
    applyLocMode();
    const c = app.quizTarget ? layerCenter(app.quizTarget) : null;
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
    const nameOnly = app.quizType === "name";
    locModeEl.hidden = nameOnly;
    if (nameOnly) {
      app.locMode = "map";
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
  if (!app.quizPeak) return;
  const m = L.marker([app.quizPeak.lat, app.quizPeak.lng], { icon: peakIcon(map.getZoom(), true), keyboard: false });
  if (withLabel) {
    m.bindTooltip('<a href="' + wikiUrl(app.quizPeak.wiki || app.quizPeak.name) + '" target="_blank" rel="noopener">' +
      escapeHtml(app.quizPeak.name) + "</a>", { permanent: true, direction: "top", interactive: true, className: "map-label" });
  }
  m.addTo(quizLayer);
}
function renderPeakChoices(): void {
  if (!app.quizPeak) return;
  const distract = shuffle(PEAKS.filter((p) => p !== app.quizPeak)).slice(0, 3);
  quizChoicesEl.innerHTML = "";
  shuffle([app.quizPeak, ...distract]).forEach((p) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.name; b.dataset.peak = p.name;
    b.addEventListener("click", () => handlePeakNameGuess(p.name));
    quizChoicesEl.appendChild(b);
  });
}
function nextPeakQuestion(): void {
  const pool = app.quizType === "peakcountry" ? PEAKS.filter((p) => p.iso.length) : PEAKS;
  if (!pool.length) return;
  let p = app.quizPeak;
  for (let i = 0; i < 20 && (!p || p === app.quizPeak); i++) p = pool[Math.floor(Math.random() * pool.length)];
  app.quizPeak = p;
  app.quizTarget = null; app.quizGuess = null; app.quizAnswered = false;
  app.quizContCorrect = null; app.quizContWrong = null; app.quizNeighbourSet = new Set();
  nbBox.hidden = true; locBox.hidden = true;
  quizContLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (app.quizType === "peakname") {
    renderPeakChoices();
    quizChoicesEl.hidden = false;
    quizFeedbackEl.textContent = "Which mountain is marked? Pick one.";
  } else {
    quizChoicesEl.hidden = true;
    quizFeedbackEl.textContent = "In which country is " + (app.quizPeak ? app.quizPeak.name : "") + "? Click it on the map.";
  }
  if (app.quizPeak) map.setView([app.quizPeak.lat, app.quizPeak.lng], 4);
  drawQuizPeak(false);
  quizNextBtn.disabled = true;
  refreshPolygons();
}
function handlePeakNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !app.quizPeak) return;
  app.quizAnswered = true; app.quizTotal++;
  const ok = name === app.quizPeak.name;
  if (ok) app.quizCorrect++;
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const n = btn.dataset.peak;
    if (n === app.quizPeak!.name) btn.classList.add("correct");
    else if (n === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "✓ Correct! " : "✗ It's ") + app.quizPeak.name +
    " — " + fmtInt(app.quizPeak.elevation) + " m, " + peakCountryNames(app.quizPeak) + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawQuizPeak(true);
}
function handlePeakCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || app.quizAnswered || !app.quizPeak || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true; app.quizTotal++;
  const ok = !!entry.iso && app.quizPeak.iso.includes(entry.iso);
  if (ok) app.quizCorrect++;
  const names = peakCountryNames(app.quizPeak);
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + app.quizPeak.name + " is in " + names + "."
    : "✗ That's " + entry.name + ". " + app.quizPeak.name + " is in " + names + ".";
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
  if (app.mode !== "explore" || app.activeTab !== "continents") return;
  const byGroup: Record<string, CountryEntry[]> = {};
  realCountries().forEach((e) => { const g = groupOf(e); if (g !== "Other") (byGroup[g] = byGroup[g] || []).push(e); });
  Object.keys(byGroup).forEach((g) => {
    const pos = (app.groupScheme === "continent" && CONTINENT_LABEL_POS[g]) || groupLabelPos(byGroup[g]);
    if (!pos) return;
    const hue = app.regionHue[g];
    const html = hue != null
      ? '<span style="color:hsl(' + hue + ',55%,30%)">' + escapeHtml(g) + "</span>"
      : escapeHtml(g);
    L.tooltip({ permanent: true, direction: "center", interactive: false, className: "map-label region-name-label" })
      .setLatLng(pos).setContent(html).addTo(regionLabelLayer);
  });
}

function answerContinent(name: string): void {
  if (app.mode !== "quiz" || app.quizType !== "continent" || !app.quizTarget || app.quizAnswered) return;
  app.quizAnswered = true;
  app.quizTotal++;
  const correct = app.quizTarget.continent || "Other";
  const ok = name === correct;
  if (ok) app.quizCorrect++;
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const c = btn.dataset.continent;
    if (c === correct) btn.classList.add("correct");
    else if (c === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + app.quizTarget.name + " is in " + correct + "."
    : "✗ " + app.quizTarget.name + " is in " + correct + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Colour the correct continent green (and the guessed one red) on the map,
  // and mark where the country itself is.
  app.quizContCorrect = correct;
  app.quizContWrong = ok ? null : name;
  refreshPolygons();
  quizLayer.clearLayers();
  const c = layerCenter(app.quizTarget);
  if (c) addQuizDot(app.quizTarget, c, "correct");
}

// --- Neighbour quiz: pick all bordering countries (search box + map clicks),
//     then Check ---
const nbBox = document.getElementById("nb-box") as HTMLElement;
const nbInput = document.getElementById("nb-input") as HTMLInputElement;
const nbResults = document.getElementById("nb-results")!;
const nbChips = document.getElementById("nb-chips")!;
const nbCheck = document.getElementById("nb-check") as HTMLButtonElement;
// Two mutually-exclusive ways to answer the Neighbour round: click the
// neighbours on the map, or search and pick them by name.
function applyNbMode(): void {
  nbBox.classList.toggle("map-mode", app.nbMode === "map");
  if (app.nbMode === "map") { nbInput.value = ""; renderNbResults(""); }
  if (app.mode === "quiz" && app.quizType === "neighbour" && !app.quizAnswered) {
    quizFeedbackEl.textContent = app.nbMode === "map"
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

function applyLocMode(): void {
  locBox.classList.toggle("map-mode", app.locMode === "map");
  if (app.locMode === "map") { locInput.value = ""; renderLocResults(""); }
  if (app.mode === "quiz" && isLocateQuiz() && !app.quizAnswered) {
    quizFeedbackEl.textContent = app.locMode === "map"
      ? "Click it on the map."
      : "Find and select the country.";
  }
}
function isLocateQuiz(): boolean {
  return app.quizType === "name" || app.quizType === "flag" || app.quizType === "capital";
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
      li.addEventListener("click", () => { if (!app.quizAnswered) { locInput.value = ""; locResults.innerHTML = ""; handleGuess(c); } });
      locResults.appendChild(li);
    });
}

function renderNbResults(query: string): void {
  const q = query.trim().toLowerCase();
  nbResults.innerHTML = "";
  if (!q || !app.quizTarget) return;
  realCountries()
    .filter((c) => c !== app.quizTarget && !app.nbSelected.has(c) && c.name.toLowerCase().indexOf(q) !== -1)
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
  app.nbSelected.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = c.name + " ";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.title = "Remove";
    x.addEventListener("click", () => { app.nbSelected.delete(c); renderNbChips(); refreshPolygons(); });
    chip.appendChild(x);
    nbChips.appendChild(chip);
  });
}
function addNbPick(c: CountryEntry): void {
  if (app.quizAnswered) return;
  app.nbSelected.add(c);
  nbInput.value = "";
  renderNbResults("");
  renderNbChips();
  refreshPolygons();
}
function toggleNbPick(c: CountryEntry): void {
  if (app.quizAnswered) return;
  if (app.nbSelected.has(c)) app.nbSelected.delete(c); else app.nbSelected.add(c);
  renderNbChips();
  refreshPolygons();
}
function nbCheckAnswers(): void {
  if (app.mode !== "quiz" || app.quizType !== "neighbour" || !app.quizTarget || app.quizAnswered) return;
  app.quizAnswered = true;
  app.quizTotal++;
  const missed = Array.from(app.quizNeighbourSet).filter((n) => !app.nbSelected.has(n));
  const wrong = Array.from(app.nbSelected).filter((p) => !app.quizNeighbourSet.has(p));
  const ok = missed.length === 0 && wrong.length === 0;
  if (ok) app.quizCorrect++;
  const total = app.quizNeighbourSet.size;
  let msg = (ok ? "✓ " : "✗ ") + "Found " + (total - missed.length) + " of " + total +
    " neighbours of " + app.quizTarget.name + ".";
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
  const tc = layerCenter(app.quizTarget);
  if (tc) addQuizDot(app.quizTarget, tc, "target");
  app.quizNeighbourSet.forEach((n) => { const c = layerCenter(n); if (c) addQuizDot(n, c, "correct"); });
  wrong.forEach((w) => { const c = layerCenter(w); if (c) addQuizDot(w, c, "wrong"); });
  try {
    let b = app.quizTarget.layer.getBounds();
    app.quizNeighbourSet.forEach((n) => { try { b = b.extend(n.layer.getBounds()); } catch { /* ignore */ } });
    map.fitBounds(b, { maxZoom: 6, padding: [50, 50] });
  } catch { /* ignore */ }
}

function handleGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || !app.quizTarget || app.quizAnswered || entry.isLandmass) return;
  app.quizGuess = entry;
  app.quizAnswered = true;
  app.quizTotal++;
  const ok = entry === app.quizTarget;
  quizLayer.clearLayers();
  const tCenter = layerCenter(app.quizTarget);
  if (ok) {
    app.quizCorrect++;
    quizFeedbackEl.className = "correct";
    quizFeedbackEl.textContent = "✓ Correct! It's " + app.quizTarget.name + ".";
    if (tCenter) addQuizDot(app.quizTarget, tCenter, "correct"); // labelled green dot
  } else {
    quizFeedbackEl.className = "wrong";
    quizFeedbackEl.innerHTML = "✗ That's " + escapeHtml(entry.name) +
      '. <a href="#" class="quiz-zoom">' + escapeHtml(app.quizTarget.name) + "</a> is the right one.";
    const z = quizFeedbackEl.querySelector(".quiz-zoom");
    if (z) z.addEventListener("click", (ev) => { ev.preventDefault(); zoomToTarget(8); });
    // Draw a line from the guess to the correct country (both labelled) so the
    // location is clear even for a tiny island. (No auto-zoom — use the link.)
    const gCenter = layerCenter(entry);
    if (gCenter && tCenter) {
      L.polyline([gCenter, tCenter], { color: "#8a3b00", weight: 2, opacity: 0.85, dashArray: "5 5" }).addTo(quizLayer);
      addQuizDot(app.quizTarget, tCenter, "correct");  // green: the right answer
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
  if (!app.quizTarget) return;
  try { map.fitBounds(app.quizTarget.layer.getBounds(), { maxZoom, padding: [50, 50] }); } catch { /* ignore */ }
}
function setMode(m: "explore" | "quiz"): void {
  app.mode = m;
  document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  (document.getElementById("explore-panel") as HTMLElement).hidden = m !== "explore";
  (document.getElementById("quiz-panel") as HTMLElement).hidden = m !== "quiz";
  hideHoverInfo();
  if (m === "explore") {
    quizLayer.clearLayers();
    quizContLayer.clearLayers();
  } else {
    app.selectedLayer = null; app.selectedContinent = null; app.expandedContinent = null;
    if (!app.quizStarted) { app.quizStarted = true; app.quizCorrect = 0; app.quizTotal = 0; nextQuestion(); }
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
quizNextBtn.addEventListener("click", () => { if (app.mode === "quiz") nextQuestion(); });
quizSkipBtn.addEventListener("click", () => { if (app.mode === "quiz") nextQuestion(); });
nbInput.addEventListener("input", () => renderNbResults(nbInput.value));
nbCheck.addEventListener("click", nbCheckAnswers);
document.querySelectorAll<HTMLInputElement>('#nb-mode input[name="nbmode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    app.nbMode = r.value === "search" ? "search" : "map";
    applyNbMode();
    if (app.nbMode === "search") nbInput.focus();
  });
});
locInput.addEventListener("input", () => renderLocResults(locInput.value));
document.querySelectorAll<HTMLInputElement>('#loc-mode input[name="locmode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    app.locMode = r.value === "search" ? "search" : "map";
    applyLocMode();
    if (app.locMode === "search" && !app.quizAnswered) locInput.focus();
  });
});
document.querySelectorAll<HTMLElement>(".qt-btn").forEach((b) => {
  b.addEventListener("click", () => {
    app.quizType = b.dataset.qtype as QuizType;
    // Scope the active state to the button's own row (Country vs Mountains).
    b.parentElement!.querySelectorAll<HTMLElement>(".qt-btn").forEach((x) => x.classList.toggle("active", x === b));
    if (app.mode === "quiz") nextQuestion();
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
    app.quizType = "continent";
  } else if (cat === "mountains") {
    const active = document.querySelector<HTMLElement>("#mtn-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "peakname";
  } else {
    const active = document.querySelector<HTMLElement>("#quiz-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "name";
  }
  if (app.mode === "quiz") nextQuestion();
}
document.querySelectorAll<HTMLElement>(".qc-tab").forEach((b) => {
  b.addEventListener("click", () => setQuizCat(b.dataset.cat as "country" | "continent" | "mountains"));
});

const capToggle = document.getElementById("show-capitals") as HTMLInputElement;
capToggle.addEventListener("change", () => { app.showCapitals = capToggle.checked; refreshCapitals(); });

const flagToggle = document.getElementById("show-flags") as HTMLInputElement;
flagToggle.addEventListener("change", () => { app.showFlags = flagToggle.checked; refreshFlags(); });

const hoverToggle = document.getElementById("show-hover") as HTMLInputElement;
hoverToggle.addEventListener("change", () => { app.showHover = hoverToggle.checked; if (!app.showHover) hideHoverInfo(); });

const mtnToggle = document.getElementById("show-mountains") as HTMLInputElement;
mtnToggle.addEventListener("change", () => { app.showPeaks = mtnToggle.checked; refreshPeaks(); });

const rivToggle = document.getElementById("show-rivers") as HTMLInputElement;
rivToggle.addEventListener("change", () => { app.showRivers = rivToggle.checked; refreshRivers(); });

const lakeToggle = document.getElementById("show-lakes") as HTMLInputElement;
lakeToggle.addEventListener("change", () => { app.showLakes = lakeToggle.checked; refreshLakes(); });

const cityToggle = document.getElementById("show-cities") as HTMLInputElement;
cityToggle.addEventListener("change", () => { app.showCities = cityToggle.checked; refreshCities(); });

const nameToggle = document.getElementById("show-names") as HTMLInputElement;
nameToggle.addEventListener("change", () => { app.showNames = nameToggle.checked; refreshCountryLabels(); });


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
  app.sortBy = sortSelect.value as "name" | "population" | "area";
  // Area needs the country dataset; load it first if sorting by area.
  if (app.sortBy === "area" && !app.countryData) loadCountryData().then(buildSidebar).catch(buildSidebar);
  else buildSidebar();
});

const schemeSelect = document.getElementById("scheme") as HTMLSelectElement;
schemeSelect.addEventListener("change", () => {
  app.groupScheme = schemeSelect.value as GroupScheme;
  // Group names differ per scheme, so any current region selection is stale.
  app.selectedContinent = null;
  app.expandedContinent = null;
  buildContinentList();
  refreshAll();
});

map.on("click", () => {        // background click clears selection / closes panels
  if (app.suppressMapClick) return; // ignore the click that came from a feature
  deselect();
  countryInfoEl.hidden = true;  // also close a feature detail box
});
map.on("zoomend", updateFlagSizes);
map.on("zoomend", updatePeakSizes);
map.on("moveend", scheduleCityUpdate);  // re-render in-view cities after pan/zoom
map.on("moveend", refreshCapitals);     // re-evaluate which capitals fit the view

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
map.getContainer().addEventListener("mousemove", (ev: MouseEvent) => trackMouse(ev.clientX, ev.clientY));

loadBorders();
