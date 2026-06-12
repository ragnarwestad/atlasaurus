// Country polygons: borders loading (incl. the hover/click handlers), styling
// and visibility rules, selection (country/continent), polygon refresh and the
// territory connector lines.
import L from "leaflet";
import {
  BORDER_URLS, SUBUNIT_URLS,
  baseStyle, hoverStyle, selectedStyle, relatedStyle, continentStyle, hiddenStyle,
  quizCorrectStyle, quizWrongStyle,
  CONNECTOR_MIN_AREA, CONNECTOR_MAX_LINES, SUBUNIT_MATCH_MAX_D2,
} from "./config";
import { allPolygonParts, centerOf, type LatLng } from "./geo";
import { wikiUrl, escapeHtml } from "./wiki";
import { map, connectorLayer } from "./map";
import {
  app, hooks, countries, byIso, subunitsByIso, territoriesBySov,
  CONTINENT_ORDER, fetchJson, loadCountryData,
  type CountryEntry, type Subunit,
} from "./state";
import { showHoverInfo, hideHoverInfo } from "./panel";
import { refreshCountryLabels, placeCountryLabels } from "./labels";
import { loadCapitals } from "./places";
import { groupOf, CONTINENT_QUIZ_STYLES } from "./regions";
// TODO(refactor): quiz handlers move to ./quiz, sidebar fns to ./sidebar.
import {
  answerContinent, toggleNbPick, handlePeakCountryGuess, handleGuess,
  buildSidebar, setActiveTab,
} from "./main";

// ---------------------------------------------------------------------------
// Status line (loading / error)
// ---------------------------------------------------------------------------
const statusEl = document.getElementById("status");
const setStatus = (msg: string) => { if (statusEl) statusEl.textContent = msg; };
const hideStatus = () => { if (statusEl) statusEl.remove(); };

// ---------------------------------------------------------------------------
// Visibility / styling helpers
// ---------------------------------------------------------------------------
function sovOf(layer: any): string | null {
  const p = (layer && layer.feature && layer.feature.properties) || {};
  return p.SOV_A3 || p.sov_a3 || null;
}
/** Same sovereign state (e.g. Denmark ↔ Greenland/Faroe), different unit. */
export function sameRealm(e: CountryEntry): boolean {
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

export function refreshPolygons(): void {
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

export function refreshConnectors(): void {
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

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
/** Single-country selection; toggle=true (map click) deselects the same country.
 *  A selected continent is kept, so picking a country inside it keeps the
 *  continent highlighted (green) with the country shown selected (orange). */
export function selectLayer(layer: L.Polygon, toggle: boolean): void {
  app.selectedLayer = toggle && app.selectedLayer === layer ? null : layer;
  if (app.selectedLayer) app.selectedLayer.bringToFront();
  hooks.refreshAll();
}
export function deselect(): void {
  if (app.selectedLayer || app.selectedContinent) { app.selectedLayer = null; app.selectedContinent = null; hooks.refreshAll(); }
}

// Select a whole continent: highlight all member countries and show aggregate
// info. Clicking the active continent again clears it. (Mutually exclusive with
// single-country selection.)
export function selectContinent(name: string): void {
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
  hooks.refreshAll();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
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

export function loadBorders(): void {
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
