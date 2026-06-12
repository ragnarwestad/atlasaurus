// Region grouping for the Explore "Regions" tab (continent / UN region /
// UN subregion / World Bank region), the per-region map tint hues, the on-map
// region name labels, and the continent-quiz tint/label tables.
import L from "leaflet";
import { escapeHtml } from "./wiki";
import { regionLabelLayer } from "./map";
import { app, realCountries, layerCenter, type CountryEntry, type GroupScheme } from "./state";

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
export function rebuildRegionColors(): void {
  const groups = Array.from(new Set(realCountries().map(groupOf))).filter((g) => g !== "Other").sort();
  app.regionHue = {};
  const n = groups.length || 1;
  groups.forEach((g, i) => { app.regionHue[g] = Math.round((360 * i) / n); });
}

// Distinct tint per continent while the continent quiz question is open.
export const CONTINENT_QUIZ_STYLES: Record<string, L.PathOptions> = {
  "Africa":        { color: "#b8860b", weight: 1, opacity: 1, fillColor: "#f2c14e", fillOpacity: 0.55 },
  "Asia":          { color: "#b1472f", weight: 1, opacity: 1, fillColor: "#e8896c", fillOpacity: 0.55 },
  "Europe":        { color: "#2f5fa0", weight: 1, opacity: 1, fillColor: "#7fb2e8", fillOpacity: 0.55 },
  "North America": { color: "#2e7d4b", weight: 1, opacity: 1, fillColor: "#8fd0a0", fillOpacity: 0.55 },
  "South America": { color: "#7a4ba0", weight: 1, opacity: 1, fillColor: "#c79be0", fillOpacity: 0.55 },
  "Oceania":       { color: "#1f8a80", weight: 1, opacity: 1, fillColor: "#6fcbc3", fillOpacity: 0.55 },
};
// Approximate on-map position for each continent's name label.
export const CONTINENT_LABEL_POS: Record<string, [number, number]> = {
  "Africa": [3, 20], "Asia": [47, 89], "Europe": [54, 22],
  "North America": [46, -100], "South America": [-15, -60], "Oceania": [-25, 134],
};

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
export function updateRegionLabels(): void {
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
