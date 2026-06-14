// Physical features: mountain peaks (Explore layer + quiz markers), major
// rivers and major lakes — markers, lazy data loading and refresh functions.
import L from "leaflet";
import { RIVER_URLS, LAKE_URLS } from "./config";
import { allPolygonParts, lineLengthKm } from "./geo";
import { wikiUrl, escapeHtml } from "./wiki";
import { PEAKS, type Peak } from "./peaks";
import { map, peakLayer, riverLayer, lakeLayer, featureCanvas } from "./map";
import { app, hooks, byIso, fmtInt, fetchJson, featureLabel, quizRevealsPeaks, quizRevealsRivers, quizRevealsLakes } from "./state";
import { renderFeatureInfo, attachLabelClick } from "./panel";
import { updatePhysLabels } from "./labels";

// A searchable entry in the sidebar feature lists (Lakes/Mountains/Rivers).
// `focus()` zooms to the feature and opens its detail box — same idea as clicking
// a country in the country list.
export interface PhysFeature { name: string; wiki: string; focus: () => void; }
export const peakList: PhysFeature[] = [];
export const riverList: PhysFeature[] = [];
export const lakeList: PhysFeature[] = [];

// Wire a clickable map feature: a click opens its detail box (suppressing the
// background-click deselect), and clicking its permanent label does the same.
function wireFeatureClick(layer: L.Layer, open: () => void): void {
  layer.on("click", (ev) => { L.DomEvent.stop(ev); app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0); open(); });
  layer.on("tooltipopen", (ev: any) => attachLabelClick(ev.tooltip, open));
}

// Load every physical dataset up front so the sidebar lists are always populated
// (rivers/lakes are otherwise fetched lazily only when their toggle is switched on).
export function loadPhysicalData(): void {
  buildPeakList();
  hooks.rebuildFeatureLists();
  if (!riverGeo) void loadRivers(); // lazy preload — errors handled inside loadRivers
  if (!lakeGeo) void loadLakes();
}

// ---------------------------------------------------------------------------
// Mountain peaks (Explore "Show mountains" layer + quiz markers)
// ---------------------------------------------------------------------------
function peakSize(zoom: number): number { return Math.round(Math.min(12 + (zoom - 2) * 5, 46)); } // grows when zoomed in
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
function peakOpen(p: Peak): void {
  renderFeatureInfo(p.name, wikiUrl(p.wiki || p.name), "Mountain peak",
    [["Elevation", fmtInt(p.elevation) + " m"], ["Country", peakCountryNames(p)], ["Region", escapeHtml(p.region)]]);
}
// Sidebar list of peaks (static data, available immediately).
function buildPeakList(): void {
  if (peakList.length) return;
  PEAKS.forEach((p) => {
    peakList.push({
      name: p.name,
      wiki: wikiUrl(p.wiki || p.name),
      focus: () => { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 6)); peakOpen(p); },
    });
  });
}
// A peak's name shows when the Mountains toggle reveals the whole type, or when
// this one was individually clicked; otherwise the label stays "Mountain ?".
function peakRevealed(name: string): boolean { return app.showPeaks || app.revealedPeaks.has(name); }
const peakMarkers: L.Marker[] = [];
function buildPeakMarkers(): void {
  if (peakMarkers.length) return;
  const z = map.getZoom();
  PEAKS.forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: peakIcon(z), keyboard: false });
    (m as any).peak = p;
    m.bindTooltip(escapeHtml(featureLabel("Mountain", p.name, peakRevealed(p.name))), { permanent: true, direction: "right", offset: peakLabelOffset(z), interactive: false, className: "map-label peak-label" });
    const open = () => { app.revealedPeaks.add(p.name); refreshPeaks(); peakOpen(p); };
    wireFeatureClick(m, open);
    peakMarkers.push(m);
  });
}
// Reveal more peaks as you zoom in, by elevation — only the giants at world view,
// country-level summits (Galdhøpiggen, …) once you're down on the region.
function peakMinZoom(elev: number): number {
  if (elev >= 6000) return 2;
  if (elev >= 4000) return 3;
  if (elev >= 2500) return 4;
  if (elev >= 1500) return 5;
  if (elev >= 800) return 6;
  return 7;
}
export function refreshPeaks(): void {
  // Practice (guess) always shows the icons; Explore (browse) only when the
  // toggle is on; Quiz hides them — except after the "Name it" peak round, when
  // we reveal all real peak names so the user can orient (the round's own marker
  // already labels the target/wrong peak, so those are skipped below).
  const reveal = quizRevealsPeaks();
  const on = app.mode === "practice" || (app.mode === "explore" && app.showPeaks) || reveal;
  if (on) buildPeakMarkers();
  const z = map.getZoom();
  peakMarkers.forEach((m) => {
    const p = (m as any).peak;
    const show = on && z >= peakMinZoom(p.elevation) && !(reveal && app.quizDotFeatures.has(p.name));
    if (show && !peakLayer.hasLayer(m)) peakLayer.addLayer(m);
    else if (!show && peakLayer.hasLayer(m)) peakLayer.removeLayer(m);
    if (show) m.setTooltipContent(escapeHtml(featureLabel("Mountain", p.name, reveal || peakRevealed(p.name))));
  });
  updatePhysLabels();
}


// --- Rivers (Explore "Rivers" layer) — major named river centerlines from
//     Natural Earth, loaded lazily the first time the toggle is switched on. ---
let riverGeo: L.GeoJSON | null = null;
let riverLoadPromise: Promise<void> | null = null;
// Each named river (all its segments) appears from this zoom, by mapped length
// rank, so the long ones show early and the short ones don't all flood in at once.
const riverEntries: { layer: L.Path; mz: number; name: string }[] = [];
function riverRevealed(name: string): boolean { return app.showRivers || app.revealedRivers.has(name); }
// Longitude span of a geometry; a span > 180° means it wraps the antimeridian,
// which renders as a stray line right across the map — drop those features.
function lngSpan(geom: any): number {
  let min = Infinity, max = -Infinity;
  const walk = (a: any) => {
    if (typeof a[0] === "number") { if (a[0] < min) min = a[0]; if (a[0] > max) max = a[0]; }
    else for (const c of a) walk(c);
  };
  if (geom && geom.coordinates) walk(geom.coordinates);
  return max - min;
}
// Some NE features carry empty coordinates → an empty path whose permanent
// "center" tooltip throws "latlngs not passed" on open. Count the leaf points so
// we can drop those before they reach the map.
function pathPointCount(layer: any): number {
  const lls = layer && layer.getLatLngs ? layer.getLatLngs() : null;
  const count = (a: any): number => (Array.isArray(a) ? a.reduce((n, x) => n + count(x), 0) : 1);
  return lls ? count(lls) : 0;
}
function loadRivers(): Promise<void> {
  if (riverGeo) return Promise.resolve();
  if (riverLoadPromise) return riverLoadPromise;
  riverLoadPromise = fetchJson(RIVER_URLS).then((geo) => {
    const riverName = (f: any) => (f.properties || {}).name || (f.properties || {}).name_en;
    const isRiver = (f: any) => String((f.properties || {}).featurecla || "").toLowerCase().indexOf("lake") === -1;
    // Named rivers only (drops the unnamed minor segments). Sum each river's mapped
    // length across its segments, then rank-spread a zoom threshold across 2→max.
    const feats = ((geo.features || []) as any[]).filter((f) => isRiver(f) && riverName(f) && lngSpan(f.geometry) <= 180);
    const lenByName: Record<string, number> = {};
    feats.forEach((f) => { lenByName[riverName(f)] = (lenByName[riverName(f)] || 0) + lineLengthKm(f.geometry); });
    const names = Object.keys(lenByName).sort((a, b) => lenByName[b] - lenByName[a]);
    const len = Math.max(1, names.length);
    const minZ = map.getMinZoom() || 2, span = (map.getMaxZoom() || 8) - minZ;
    const mzByName: Record<string, number> = {};
    // sqrt curve front-loads the low end: only the few longest rivers at world view.
    // Keep z2/z3 sparse (just the giants), but pull everything that would land at
    // z5+ one level earlier, so mid rivers like the Po show from z4 on.
    names.forEach((nm, i) => {
      const natural = minZ + Math.floor(Math.sqrt(i / len) * span);
      mzByName[nm] = natural >= 5 ? natural - 1 : natural;
    });
    // Per-name accumulation for the sidebar list: one entry per river, zooming to
    // the union of all its segments.
    const boundsByName: Record<string, L.LatLngBounds> = {};
    const openByName: Record<string, () => void> = {};
    riverGeo = L.geoJSON({ type: "FeatureCollection", features: feats } as any, {
      style: () => ({ renderer: featureCanvas, color: "#3d83c4", weight: 1.5, opacity: 0.85 }),
      onEachFeature: (f: any, layer: L.Layer) => {
        const name = riverName(f);
        if (pathPointCount(layer) < 2) return; // skip empty/degenerate geometry (would throw on tooltip-center)
        riverEntries.push({ layer: layer as L.Path, mz: mzByName[name] ?? (map.getMaxZoom() || 8), name });
        (layer as L.Path).bindTooltip(escapeHtml(featureLabel("River", name, riverRevealed(name))),
          { permanent: true, direction: "center", interactive: false, className: "map-label river-label" });
        const km = lenByName[name]; // whole named river's mapped length
        const open = () => { app.revealedRivers.add(name); refreshRivers(); renderFeatureInfo(name, wikiUrl(name), "River", km > 1 ? [["Length", "≈ " + fmtInt(km) + " km (mapped course)"]] : []); };
        wireFeatureClick(layer, open);
        const lb = (layer as L.Polyline).getBounds();
        boundsByName[name] = boundsByName[name] ? boundsByName[name].extend(lb) : L.latLngBounds(lb.getSouthWest(), lb.getNorthEast());
        openByName[name] = open;
      },
    });
    Object.keys(openByName).forEach((nm) => {
      const b = boundsByName[nm];
      riverList.push({ name: nm, wiki: wikiUrl(nm), focus: () => { try { map.fitBounds(b, { maxZoom: 7, padding: [40, 40] }); } catch {} openByName[nm](); } });
    });
    riverGeo.clearLayers(); // detach; we add/remove the individual lines via riverLayer below
    hooks.rebuildFeatureLists();
    refreshRivers();
  }).catch(() => { riverLoadPromise = null; });
  return riverLoadPromise;
}
// Manage each river line directly in riverLayer: show it only when the toggle is on
// AND the zoom has reached its threshold. (Direct membership, no nested group, so
// the result is the same whether triggered by the toggle or by zooming.)
function updateRiverVisibility(): void {
  const reveal = quizRevealsRivers(); // after "Name it", reveal all real river names
  const on = app.mode === "practice" || (app.mode === "explore" && app.showRivers) || reveal;
  const z = map.getZoom();
  riverEntries.forEach((e) => {
    const show = on && z >= e.mz && !(reveal && app.quizDotFeatures.has(e.name));
    if (show) {
      e.layer.setTooltipContent(escapeHtml(featureLabel("River", e.name, reveal || riverRevealed(e.name))));
      if (!riverLayer.hasLayer(e.layer)) riverLayer.addLayer(e.layer);
    } else if (riverLayer.hasLayer(e.layer)) {
      riverLayer.removeLayer(e.layer);
    }
  });
}
export function refreshRivers(): void {
  if (app.mode !== "quiz" && !riverGeo) { void loadRivers(); return; }
  updateRiverVisibility();
}

// Re-evaluate rivers + lakes after the map has fully settled. Bound to `moveend`
// (which also fires after a zoom) and deferred to the next frame so the shared
// canvas renderer has finished repositioning — adding paths to it mid-zoom throws.
let physUpdateScheduled = false;
export function schedulePhysicalUpdate(): void {
  if (physUpdateScheduled) return;
  physUpdateScheduled = true;
  requestAnimationFrame(() => { physUpdateScheduled = false; refreshPeaks(); refreshRivers(); refreshLakes(); });
}

// --- Lakes (Explore "Lakes" layer) — major lakes from Natural Earth, lazy. ---
let lakeGeo: L.GeoJSON | null = null;
let lakeLoadPromise: Promise<void> | null = null;
// Each named lake (all its polygons) appears from this zoom, by computed area, so
// big lakes show early and the small ones don't all flood in at once.
const lakeEntries: { layer: L.Path; mz: number; name: string }[] = [];
function lakeRevealed(name: string): boolean { return app.showLakes || app.revealedLakes.has(name); }
function lakeMinZoom(km2: number): number {
  if (km2 >= 50000) return 2;
  if (km2 >= 15000) return 3;
  if (km2 >= 4000) return 4;
  if (km2 >= 800) return 5;
  if (km2 >= 150) return 6;
  return 7;
}
function loadLakes(): Promise<void> {
  if (lakeGeo) return Promise.resolve();
  if (lakeLoadPromise) return lakeLoadPromise;
  lakeLoadPromise = fetchJson(LAKE_URLS).then((geo) => {
    const lakeName = (f: any) => (f.properties || {}).name || (f.properties || {}).name_en;
    const areaOf = (f: any) => { try { return allPolygonParts(f.geometry).reduce((s: number, p) => s + Math.abs(p.area), 0); } catch { return 0; } };
    // Named lakes only, and when a name appears on several polygons (NE splits or
    // mislabels — e.g. a second "Femunden" that's really Isteren) keep the label on
    // the largest one so it isn't shown twice.
    const named = ((geo.features || []) as any[]).filter((f) => lakeName(f) && lngSpan(f.geometry) <= 180);
    named.forEach((f) => { f.__a = areaOf(f); });
    const best: Record<string, any> = {};
    named.forEach((f) => { const n = lakeName(f); if (!best[n] || f.__a > best[n].__a) best[n] = f; });
    const mzByName: Record<string, number> = {}; // a lake's zoom threshold (shared by its polygons)
    const pending: { layer: L.Path; name: string }[] = [];
    lakeGeo = L.geoJSON({ type: "FeatureCollection", features: named } as any, {
      style: () => ({ renderer: featureCanvas, color: "#2e7cc4", weight: 0.8, opacity: 0.9, fillColor: "#7bb8e8", fillOpacity: 0.85 }),
      onEachFeature: (f: any, layer: L.Layer) => {
        const name = lakeName(f);
        if (pathPointCount(layer) < 3) return; // skip empty/degenerate polygon (would throw on tooltip-center)
        pending.push({ layer: layer as L.Path, name });
        if (best[name] !== f) return; // only the largest polygon per name gets a label + drives the threshold
        // Rough area from the polygon: shoelace deg² → km² with a latitude correction.
        // (Natural Earth carries no lake area, so this is computed and approximate.)
        let km2 = 0;
        try { km2 = (f.__a || 0) * 12309 * Math.cos((layer as L.Polygon).getBounds().getCenter().lat * Math.PI / 180); } catch { /* 0 */ }
        mzByName[name] = lakeMinZoom(km2);
        const rows: [string, string][] = km2 > 1 ? [["Area", "≈ " + fmtInt(km2) + " km²"]] : [];
        (layer as L.Path).bindTooltip(escapeHtml(featureLabel("Lake", name, lakeRevealed(name))),
          { permanent: true, direction: "center", interactive: false, className: "map-label lake-label" });
        const open = () => { app.revealedLakes.add(name); refreshLakes(); renderFeatureInfo(name, wikiUrl(name), "Lake", rows); };
        wireFeatureClick(layer, open);
        const lb = (layer as L.Polygon).getBounds();
        lakeList.push({ name, wiki: wikiUrl(name), focus: () => { try { map.fitBounds(lb, { maxZoom: 7, padding: [40, 40] }); } catch {} open(); } });
      },
    });
    pending.forEach((p) => lakeEntries.push({ layer: p.layer, mz: mzByName[p.name] ?? 7, name: p.name }));
    lakeGeo.clearLayers(); // detach; we add/remove the individual lakes via lakeLayer below
    hooks.rebuildFeatureLists();
    refreshLakes();
  }).catch(() => { lakeLoadPromise = null; });
  return lakeLoadPromise;
}
// Manage each lake directly in lakeLayer: show only when the toggle is on AND the
// zoom has reached its area threshold (direct membership, no nested group).
function updateLakeVisibility(): void {
  const reveal = quizRevealsLakes(); // after "Name it", reveal all real lake names
  const on = app.mode === "practice" || (app.mode === "explore" && app.showLakes) || reveal;
  const z = map.getZoom();
  lakeEntries.forEach((e) => {
    const show = on && z >= e.mz && !(reveal && app.quizDotFeatures.has(e.name));
    if (show) {
      e.layer.setTooltipContent(escapeHtml(featureLabel("Lake", e.name, reveal || lakeRevealed(e.name)))); // no-op on the unlabeled polygons
      if (!lakeLayer.hasLayer(e.layer)) lakeLayer.addLayer(e.layer);
    } else if (lakeLayer.hasLayer(e.layer)) {
      lakeLayer.removeLayer(e.layer);
    }
  });
}
export function refreshLakes(): void {
  if (app.mode !== "quiz" && !lakeGeo) { void loadLakes(); return; }
  updateLakeVisibility();
}

// ---------------------------------------------------------------------------
// Rivers / Lakes quiz ("Name it"): the feature has no country data and is often
// multi-country, so there is no "Which country" round — only name recognition.
// The pool is the prominent named features (low zoom threshold = big/famous),
// each carrying its geometry layers + union bounds so the quiz can highlight it.
// ---------------------------------------------------------------------------
export interface WaterQuizItem { name: string; mz: number; bounds: L.LatLngBounds; layers: L.Path[]; }
function buildWaterPool(entries: { layer: L.Path; mz: number; name: string }[]): WaterQuizItem[] {
  const byName: Record<string, { layers: L.Path[]; mz: number; bounds: L.LatLngBounds | null }> = {};
  entries.forEach((e) => {
    const g = byName[e.name] || (byName[e.name] = { layers: [], mz: e.mz, bounds: null });
    g.layers.push(e.layer);
    g.mz = Math.min(g.mz, e.mz);
    try { const b = (e.layer as any).getBounds(); g.bounds = g.bounds ? g.bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast()); } catch { /* skip */ }
  });
  const items = Object.keys(byName)
    .map((name) => ({ name, mz: byName[name].mz, bounds: byName[name].bounds, layers: byName[name].layers }))
    .filter((it): it is WaterQuizItem => !!it.bounds);
  // Prefer the prominent (low-zoom) features for a gameable pool; fall back to all
  // if there aren't enough. Sorted big-first.
  const prominent = items.filter((it) => it.mz <= 4);
  return (prominent.length >= 12 ? prominent : items).sort((a, b) => a.mz - b.mz);
}
let riverPoolCache: WaterQuizItem[] | null = null;
let lakePoolCache: WaterQuizItem[] | null = null;
export function riverQuizPool(): WaterQuizItem[] {
  if (!riverPoolCache && riverGeo) riverPoolCache = buildWaterPool(riverEntries);
  return riverPoolCache || [];
}
export function lakeQuizPool(): WaterQuizItem[] {
  if (!lakePoolCache && lakeGeo) lakePoolCache = buildWaterPool(lakeEntries);
  return lakePoolCache || [];
}
export function riversReady(): boolean { return !!riverGeo; }
export function lakesReady(): boolean { return !!lakeGeo; }
export function loadRiverData(): Promise<void> { return loadRivers(); }
export function loadLakeData(): Promise<void> { return loadLakes(); }

export function updatePeakSizes(): void {
  const z = map.getZoom();
  const off = peakLabelOffset(z);
  peakMarkers.forEach((m) => {
    m.setIcon(peakIcon(z));
    const tt = m.getTooltip();
    if (tt) { tt.options.offset = L.point(off); tt.update(); } // keep the label clear of the (resized) icon
  });
  updatePhysLabels();
}

export function peakCountryNames(p: Peak): string {
  if (!p.iso.length) return "Antarctica";
  return p.iso.map((c) => (byIso[c] ? byIso[c].name : c)).join(" / ");
}
