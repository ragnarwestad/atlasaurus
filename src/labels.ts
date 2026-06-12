// On-map country name labels and flag markers (placement, zoom scaling and
// visibility), plus the zoom-gated visibility classes for peak/river/lake labels.
import L from "leaflet";
import { allPolygonParts, centerOf, type PolyPart } from "./geo";
import { escapeHtml } from "./wiki";
import { map, flagLayer } from "./map";
import { app, countries, popOf } from "./state";
import { countryVisible, inToggleScope, isRevealed } from "./countries";

// Like capitals/cities: show only a few (biggest) country names when zoomed out,
// more as you zoom in, and only the ones in view — so the world view isn't a wall
// of ~200 labels. Ranked by population; the selected country is always shown.
const NAME_MAX = 70; // ceiling, grows with zoom
export function refreshCountryLabels(): void {
  if (app.mode === "quiz") {
    countries.forEach((e) => { const el = e.labelTooltip && e.labelTooltip.getElement(); if (el) el.style.display = "none"; });
    return;
  }
  const z = map.getZoom();
  const cap = Math.max(8, Math.min(NAME_MAX, Math.round((z - 1) * 12)));
  const b = map.getBounds().pad(0.15);
  const shown = new Set(
    countries
      .filter((e) => e.labelTooltip && countryVisible(e) && app.showNames && inToggleScope(e))
      .filter((e) => { const ll = e.labelTooltip!.getLatLng(); return !!ll && b.contains(ll); })
      .sort((a, c) => popOf(c) - popOf(a))
      .slice(0, cap),
  );
  // The selected/revealed country's name is always shown (even with the toggle off).
  countries.forEach((e) => { if (e.labelTooltip && countryVisible(e) && isRevealed(e)) shown.add(e); });
  countries.forEach((e) => {
    const el = e.labelTooltip && e.labelTooltip.getElement();
    if (el) el.style.display = shown.has(e) ? "" : "none";
  });
}

// ---------------------------------------------------------------------------
// Flags (scale with zoom)
// ---------------------------------------------------------------------------
export function flagIcon(iso2: string, zoom: number): L.DivIcon {
  const scale = Math.min(0.78 + (zoom - 2) * 0.33, 3); // smaller when zoomed out (~19px at z2)
  const w = Math.round(24 * scale), h = Math.round(18 * scale);
  return L.divIcon({
    className: "flag-icon",
    html: '<img src="https://flagcdn.com/48x36/' + iso2 + '.png" width="' + w + '" height="' + h + '" alt="">',
    iconSize: [w, h],
    iconAnchor: [w / 2, h + 8], // sit just above the centroid
  });
}
export function updateFlagSizes(): void {
  const z = map.getZoom();
  countries.forEach((e) => {
    if (e.flagMarker && e.iso2) e.flagMarker.setIcon(flagIcon(e.iso2, z));
  });
}

export function refreshFlags(): void {
  if (app.mode === "quiz") { countries.forEach((e) => { if (e.flagMarker && flagLayer.hasLayer(e.flagMarker)) flagLayer.removeLayer(e.flagMarker); }); return; }
  countries.forEach((e) => {
    if (!e.flagMarker) return;
    const visible = countryVisible(e) && ((app.showFlags && inToggleScope(e)) || isRevealed(e));
    const has = flagLayer.hasLayer(e.flagMarker);
    if (visible && !has) flagLayer.addLayer(e.flagMarker);
    else if (!visible && has) flagLayer.removeLayer(e.flagMarker);
  });
}

// ---------------------------------------------------------------------------
// Labels + flags placement
// ---------------------------------------------------------------------------
export function placeCountryLabels(): void {
  countries.forEach((entry) => {
    if (entry.labelPlaced) return;
    let parts: PolyPart[];
    try { parts = allPolygonParts(entry.layer.feature && entry.layer.feature.geometry); }
    catch { parts = []; }
    if (!parts.length || !parts[0].rings[0] || parts[0].rings[0].length < 3) return;

    const center = centerOf(parts[0].rings);
    entry.labelTooltip = L.tooltip({
      permanent: true, direction: "center", offset: [0, 0],
      className: "map-label country-label", opacity: 1, interactive: false,
    }).setLatLng(center).setContent(escapeHtml(entry.name)).addTo(map);

    if (entry.iso2) {
      entry.flagMarker = L.marker(center, {
        interactive: false, keyboard: false, icon: flagIcon(entry.iso2, map.getZoom()),
      });
    }
    entry.labelPlaced = true;
  });
  refreshFlags();
}

// Peak/river names get crowded when zoomed out, so hide the labels below a zoom
// threshold — the icons and lines still show every feature.
export function updatePeakLabels(): void {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  const on = map.getZoom() >= 4;
  mapEl.classList.toggle("peak-labels-on", on);
  mapEl.classList.toggle("river-labels-on", on);
  mapEl.classList.toggle("lake-labels-on", on);
}
