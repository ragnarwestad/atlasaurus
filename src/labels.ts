// On-map country name labels and flag markers (placement, zoom scaling and
// visibility), plus the zoom-gated visibility classes for peak/river/lake labels.
import L from "leaflet";
import { allPolygonParts, centerOf, type PolyPart } from "./geo";
import { escapeHtml } from "./wiki";
import { map, flagLayer } from "./map";
import { app, countries, realCountries } from "./state";
import { countryVisible, inToggleScope, isRevealed } from "./countries";

// Each country gets a fixed "show its name from this zoom" threshold, spread by
// land area across the zoom range (biggest at min zoom, smallest at max). This
// makes a name's visibility depend only on zoom + being on screen — NOT on which
// other countries happen to be in view, so panning no longer flickers labels.
export function assignLabelZooms(): void {
  const ranked = realCountries().filter((e) => e.labelArea != null)
    .sort((a, c) => (c.labelArea as number) - (a.labelArea as number));
  const n = Math.max(1, ranked.length - 1);
  const span = (map.getMaxZoom() || 8) - (map.getMinZoom() || 2);
  ranked.forEach((e, i) => { e.labelMinZoom = (map.getMinZoom() || 2) + Math.floor((i * span) / n); });
}

export function refreshCountryLabels(): void {
  if (app.mode === "quiz") {
    countries.forEach((e) => { const el = e.labelTooltip && e.labelTooltip.getElement(); if (el) el.style.display = "none"; });
    return;
  }
  const z = map.getZoom();
  const b = map.getBounds().pad(0.15);
  countries.forEach((e) => {
    const el = e.labelTooltip && e.labelTooltip.getElement();
    if (!el) return;
    const ll = e.labelTooltip!.getLatLng();
    const inView = !!ll && b.contains(ll);
    const byZoom = app.showNames && inToggleScope(e) && z >= (e.labelMinZoom ?? 0);
    const show = countryVisible(e) && ((byZoom && inView) || isRevealed(e));
    el.style.display = show ? "" : "none";
  });
}

// ---------------------------------------------------------------------------
// Flags (scale with zoom)
// ---------------------------------------------------------------------------
export function flagIcon(iso2: string, zoom: number): L.DivIcon {
  // Grow with zoom: tiny when zoomed out (~12px at z2, so the world view isn't a
  // wall of flags), up to ~3.2× when zoomed in.
  const scale = Math.min(0.5 + (zoom - 2) * 0.38, 3.2);
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
    entry.labelArea = Math.abs(parts[0].area); // largest landmass, for name-density ranking
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
  assignLabelZooms();
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
