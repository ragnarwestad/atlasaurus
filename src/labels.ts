// On-map country name labels and flag markers (placement, zoom scaling and
// visibility), plus the zoom-gated visibility classes for peak/river/lake labels.
import L from "leaflet";
import { allPolygonParts, centerOf, type PolyPart } from "./geo";
import { escapeHtml } from "./wiki";
import { map, flagLayer } from "./map";
import { app, countries, featureLabel, quizRevealsCountries, realCountries, type CountryEntry } from "./state";
import { countryVisible, inToggleScope, isRevealed, selectLayer } from "./countries";

// A country's name shows when the Countries toggle reveals all names, when it's
// selected/in the selected realm, or when it was individually clicked; otherwise
// the label stays "Country ?".
function countryRevealed(e: CountryEntry): boolean {
  return app.showNames || isRevealed(e) || app.revealedCountries.has(e.name);
}

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
  // After answering a country round we reveal every real name (zoom-gated, in
  // view) so the user can orient; otherwise the quiz hides the on-map labels.
  const reveal = quizRevealsCountries();
  if (app.mode === "quiz" && !reveal) {
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
    const byZoom = inToggleScope(e) && z >= (e.labelMinZoom ?? 0); // shown by zoom even when anonymous
    if (reveal) {
      // Skip countries already carrying a reveal dot — their name is shown there.
      const show = byZoom && inView && !app.quizDotCountries.has(e.name);
      if (show) e.labelTooltip!.setContent(escapeHtml(e.name));
      el.style.display = show ? "" : "none";
      return;
    }
    // Practice shows the (anonymous) label by zoom; browse only when the names
    // toggle is on or the country is selected.
    const nameAllowed = app.mode === "explore" ? (app.showNames || isRevealed(e)) : true;
    const show = countryVisible(e) && nameAllowed && ((byZoom && inView) || isRevealed(e));
    if (show) e.labelTooltip!.setContent(escapeHtml(featureLabel("Country", e.name, countryRevealed(e))));
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
    }).setLatLng(center).setContent(escapeHtml(featureLabel("Country", entry.name, countryRevealed(entry)))).addTo(map);

    if (entry.iso2) {
      entry.flagMarker = L.marker(center, {
        interactive: true, keyboard: false, icon: flagIcon(entry.iso2, map.getZoom()),
      });
      // Clicking a flag selects/opens its country, same as clicking the polygon.
      entry.flagMarker.on("click", (e) => {
        L.DomEvent.stop(e);
        app.suppressMapClick = true;
        setTimeout(() => { app.suppressMapClick = false; }, 0);
        if (app.mode !== "quiz") selectLayer(entry.layer, true);
      });
    }
    entry.labelPlaced = true;
  });
  assignLabelZooms();
  refreshFlags();
}

// Peak/river/lake names get crowded at world view, so hide all three label types
// below zoom 3 — the icons, lines and lake shapes still show their biggest
// features. The user zooms in a touch to read (and guess) the names.
export function updatePhysLabels(): void {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  mapEl.classList.toggle("phys-labels-on", map.getZoom() >= 3);
}
