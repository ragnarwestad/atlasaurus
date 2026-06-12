// Populated places: national capitals (Natural Earth admin-0 capitals) and the
// Cities layer (10m populated places, canvas dots + a few DOM name labels).
import L from "leaflet";
import { CAPITAL_URLS, CITY_URLS } from "./config";
import { cityWikiUrl, escapeHtml } from "./wiki";
import { map, capitalLayer, cityLayer, cityLabelLayer, cityCanvas } from "./map";
import {
  app, countries, capitalMarkers, popOf, fmtInt, fetchJson, placeMinZoom,
  type CountryEntry, type CapitalMarker,
} from "./state";
import { renderFeatureInfo, attachLabelClick } from "./panel";
import { countryVisible, inToggleScope, isRevealed } from "./countries";

const CAPITAL_MAX = 70; // ceiling on capitals shown per view (grows with zoom)
export function refreshCapitals(): void {
  if (app.mode === "quiz") { capitalMarkers.forEach((m) => { if (capitalLayer.hasLayer(m)) capitalLayer.removeLayer(m); }); return; }
  const z = map.getZoom();
  const cap = Math.max(8, Math.min(CAPITAL_MAX, Math.round((z - 1) * 20)));
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

export function loadCapitals(): void {
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
  const cap = Math.max(8, Math.min(CITY_MAX, Math.round((zReal - 1) * 20)));
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
export function scheduleCityUpdate(): void {
  if (cityUpdateScheduled) return;
  cityUpdateScheduled = true;
  requestAnimationFrame(() => { cityUpdateScheduled = false; updateCities(); });
}
export function refreshCities(): void { updateCities(); }
