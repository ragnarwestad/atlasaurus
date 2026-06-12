// Physical features: mountain peaks (Explore layer + quiz markers), major
// rivers and major lakes — markers, lazy data loading and refresh functions.
import L from "leaflet";
import { RIVER_URLS, LAKE_URLS } from "./config";
import { allPolygonParts, lineLengthKm } from "./geo";
import { wikiUrl, escapeHtml } from "./wiki";
import { PEAKS, type Peak } from "./peaks";
import { map, peakLayer, riverLayer, lakeLayer } from "./map";
import { app, byIso, fmtInt, fetchJson } from "./state";
import { renderFeatureInfo, attachLabelClick } from "./panel";
import { updatePeakLabels } from "./labels";

// ---------------------------------------------------------------------------
// Mountain peaks (Explore "Show mountains" layer + quiz markers)
// ---------------------------------------------------------------------------
function peakSize(zoom: number): number { return Math.round(Math.min(22 + (zoom - 2) * 5, 46)); } // grows when zoomed in
function peakLabelOffset(zoom: number): L.PointExpression { return [Math.round(peakSize(zoom) / 4) + 5, 0]; }
export function peakIcon(zoom: number, highlight = false): L.DivIcon {
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
    m.bindTooltip(escapeHtml(p.name), { permanent: true, direction: "right", offset: peakLabelOffset(z), interactive: false, className: "map-label peak-label" });
    const open = () => renderFeatureInfo(p.name, wikiUrl(p.wiki || p.name), "Mountain peak",
      [["Elevation", fmtInt(p.elevation) + " m"], ["Country", peakCountryNames(p)], ["Region", escapeHtml(p.region)]]);
    m.on("click", (e) => { L.DomEvent.stop(e); app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0); open(); });
    m.on("tooltipopen", (e: any) => attachLabelClick(e.tooltip, open));
    peakMarkers.push(m);
  });
}
export function refreshPeaks(): void {
  const on = app.showPeaks && app.mode === "explore";
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
        if (!name) return;
        (layer as L.Path).bindTooltip(escapeHtml(name),
          { permanent: true, direction: "center", interactive: false, className: "map-label river-label" });
        const km = lineLengthKm(f.geometry);
        const open = () => renderFeatureInfo(name, wikiUrl(name), "River", km > 1 ? [["Length", "≈ " + fmtInt(km) + " km (mapped course)"]] : []);
        layer.on("click", (ev) => { L.DomEvent.stop(ev); app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0); open(); });
        layer.on("tooltipopen", (ev: any) => attachLabelClick(ev.tooltip, open));
      },
    });
    riversLoading = false;
    refreshRivers();
  }).catch(() => { riversLoading = false; });
}
export function refreshRivers(): void {
  const on = app.showRivers && app.mode === "explore";
  if (on && !riverGeo) { loadRivers(); return; }
  if (!riverGeo) return;
  if (on && !riverLayer.hasLayer(riverGeo)) riverLayer.addLayer(riverGeo);
  else if (!on && riverLayer.hasLayer(riverGeo)) riverLayer.removeLayer(riverGeo);
  updatePeakLabels();
}

// --- Lakes (Explore "Lakes" layer) — major lakes from Natural Earth, lazy. ---
let lakeGeo: L.GeoJSON | null = null;
let lakesLoading = false;
// Each named lake (all its polygons) appears from this zoom, by computed area, so
// big lakes show early and the small ones don't all flood in at once.
const lakeEntries: { layer: L.Path; mz: number }[] = [];
function lakeMinZoom(km2: number): number {
  if (km2 >= 50000) return 2;
  if (km2 >= 15000) return 3;
  if (km2 >= 4000) return 4;
  if (km2 >= 800) return 5;
  if (km2 >= 150) return 6;
  return 7;
}
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
    const mzByName: Record<string, number> = {}; // a lake's zoom threshold (shared by its polygons)
    const pending: { layer: L.Path; name: string }[] = [];
    lakeGeo = L.geoJSON({ type: "FeatureCollection", features: named } as any, {
      style: () => ({ color: "#2e7cc4", weight: 0.8, opacity: 0.9, fillColor: "#7bb8e8", fillOpacity: 0.85 }),
      onEachFeature: (f: any, layer: L.Layer) => {
        const name = lakeName(f);
        pending.push({ layer: layer as L.Path, name });
        if (best[name] !== f) return; // only the largest polygon per name gets a label + drives the threshold
        // Rough area from the polygon: shoelace deg² → km² with a latitude correction.
        // (Natural Earth carries no lake area, so this is computed and approximate.)
        let km2 = 0;
        try { km2 = (f.__a || 0) * 12309 * Math.cos((layer as L.Polygon).getBounds().getCenter().lat * Math.PI / 180); } catch { /* 0 */ }
        mzByName[name] = lakeMinZoom(km2);
        const rows: [string, string][] = km2 > 1 ? [["Area", "≈ " + fmtInt(km2) + " km²"]] : [];
        (layer as L.Path).bindTooltip(escapeHtml(name),
          { permanent: true, direction: "center", interactive: false, className: "map-label lake-label" });
        const open = () => renderFeatureInfo(name, wikiUrl(name), "Lake", rows);
        layer.on("click", (ev) => { L.DomEvent.stop(ev); app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0); open(); });
        layer.on("tooltipopen", (ev: any) => attachLabelClick(ev.tooltip, open));
      },
    });
    pending.forEach((p) => lakeEntries.push({ layer: p.layer, mz: mzByName[p.name] ?? 7 }));
    lakesLoading = false;
    refreshLakes();
  }).catch(() => { lakesLoading = false; });
}
// Show only the lakes whose area threshold the current zoom has reached.
function updateLakeVisibility(): void {
  if (!lakeGeo) return;
  const z = map.getZoom();
  lakeEntries.forEach((e) => {
    const show = z >= e.mz;
    if (show && !lakeGeo!.hasLayer(e.layer)) lakeGeo!.addLayer(e.layer);
    else if (!show && lakeGeo!.hasLayer(e.layer)) lakeGeo!.removeLayer(e.layer);
  });
}
export function refreshLakes(): void {
  const on = app.showLakes && app.mode === "explore";
  if (on && !lakeGeo) { loadLakes(); return; }
  if (!lakeGeo) return;
  if (on && !lakeLayer.hasLayer(lakeGeo)) lakeLayer.addLayer(lakeGeo);
  else if (!on && lakeLayer.hasLayer(lakeGeo)) lakeLayer.removeLayer(lakeGeo);
  if (on) updateLakeVisibility();
}

export function updatePeakSizes(): void {
  const z = map.getZoom();
  const off = peakLabelOffset(z);
  peakMarkers.forEach((m) => {
    m.setIcon(peakIcon(z));
    const tt = m.getTooltip();
    if (tt) { tt.options.offset = L.point(off); tt.update(); } // keep the label clear of the (resized) icon
  });
  updatePeakLabels();
}

export function peakCountryNames(p: Peak): string {
  if (!p.iso.length) return "Antarctica";
  return p.iso.map((c) => (byIso[c] ? byIso[c].name : c)).join(" / ");
}
