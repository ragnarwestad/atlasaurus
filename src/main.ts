import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

import {
  BORDER_URLS, CAPITAL_URLS, SUBUNIT_URLS,
  baseStyle, hoverStyle, selectedStyle, relatedStyle, hiddenStyle,
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
  return !(isolate && selectedLayer) || e.layer === selectedLayer || sameRealm(e);
}

function refreshCountryLabels(): void {
  countries.forEach((e) => {
    if (!e.labelTooltip) return;
    const el = e.labelTooltip.getElement();
    if (el) el.style.display = countryVisible(e) && (showNames || isRevealed(e)) ? "" : "none";
  });
}

function refreshCapitals(): void {
  capitalMarkers.forEach((m) => {
    const e = m._entry;
    const cv = e ? countryVisible(e) : !(isolate && selectedLayer);
    const visible = cv && (showCapitals || (e ? isRevealed(e) : false));
    const has = capitalLayer.hasLayer(m);
    if (visible && !has) capitalLayer.addLayer(m);
    else if (!visible && has) capitalLayer.removeLayer(m);
  });
}

function refreshFlags(): void {
  countries.forEach((e) => {
    if (!e.flagMarker) return;
    const visible = countryVisible(e) && (showFlags || isRevealed(e));
    const has = flagLayer.hasLayer(e.flagMarker);
    if (visible && !has) flagLayer.addLayer(e.flagMarker);
    else if (!visible && has) flagLayer.removeLayer(e.flagMarker);
  });
}

// --- Off-map hover info panel (flag + name + capital) ---
const hoverInfoEl = document.getElementById("hoverinfo")!;
function showHoverInfo(e: CountryEntry): void {
  const flag = e.iso2 ? '<img src="https://flagcdn.com/32x24/' + e.iso2 + '.png" alt="">' : "";
  const cap = e.capitalName ? '<span class="hi-cap">· ' + escapeHtml(e.capitalName) + "</span>" : "";
  hoverInfoEl.innerHTML = flag + '<span class="hi-name">' + escapeHtml(e.name) + "</span> " + cap;
  hoverInfoEl.hidden = false;
}
function hideHoverInfo(): void {
  hoverInfoEl.hidden = true;
}

function styleForLayer(e: CountryEntry): L.PathOptions | null {
  if (isolate && selectedLayer && e.layer !== selectedLayer && !sameRealm(e)) return null;
  if (e.layer === selectedLayer) return selectedStyle;
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

function addConnector(home: LatLng, tip: LatLng, name: string | null, seen: Record<string, boolean>): void {
  L.polyline([home, tip], {
    color: "#8a3b00", weight: 1, opacity: 0.7, dashArray: "4 4", interactive: false,
  }).addTo(connectorLayer);
  if (name && !seen[name]) {
    seen[name] = true;
    const html = '<a href="' + wikiUrl(name) + '" target="_blank" rel="noopener">' + escapeHtml(name) + "</a>";
    L.tooltip({
      permanent: true, interactive: true, direction: "right", offset: [6, 0],
      className: "map-label connector-label", opacity: 1,
    }).setLatLng(tip).setContent(html).addTo(connectorLayer);
  }
}

function refreshConnectors(): void {
  connectorLayer.clearLayers();
  if (!selectedLayer) return; // satellite lines show on selection, isolate or not
  const feat = (selectedLayer as any).feature;
  const parts = allPolygonParts(feat && feat.geometry);
  if (!parts.length) return;
  const props = (feat && feat.properties) || {};
  const iso = props.ADM0_A3 || props.adm0_a3 || null;
  const sov = props.SOV_A3 || props.sov_a3 || null;
  const home = centerOf(parts[0].rings);
  const seen: Record<string, boolean> = {};
  let n = 0;

  // (a) Detached parts WITHIN the same country feature, but only those we can
  //     name from a sub-unit (Alaska, Hawaii, French Guiana, Réunion …).
  //     Unnamed coastal islets (e.g. around Greenland) are skipped as clutter.
  for (let i = 1; i < parts.length && n < CONNECTOR_MAX_LINES; i++) {
    if (parts[i].area < CONNECTOR_MIN_AREA) break; // sorted largest-first
    const tip = centerOf(parts[i].rings);
    const nm = nearestSubunitName(iso, tip);
    if (!nm) continue;
    addConnector(home, tip, nm, seen);
    n++;
  }

  // (b) Separate features under the SAME sovereign (Greenland & Faroe for
  //     Denmark; Falklands, Gibraltar, Bermuda … for the UK).
  const terrs = (sov && territoriesBySov[sov]) || [];
  for (let j = 0; j < terrs.length && n < CONNECTOR_MAX_LINES; j++) {
    const t = terrs[j];
    if (t.adm0 === iso) continue; // skip the sovereign country itself
    addConnector(home, [t.lat, t.lng], t.name, seen);
    n++;
  }
}

// ---------------------------------------------------------------------------
// Flags (scale with zoom)
// ---------------------------------------------------------------------------
function flagIcon(iso2: string, zoom: number): L.DivIcon {
  const scale = Math.min(1 + (zoom - 2) * 0.35, 3); // 24px at z2 → up to ~72px
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
}

/** Single-choice selection; toggle=true (map click) deselects the same country. */
function selectLayer(layer: L.Polygon, toggle: boolean): void {
  selectedLayer = toggle && selectedLayer === layer ? null : layer;
  if (selectedLayer) selectedLayer.bringToFront();
  refreshAll();
}
function deselect(): void {
  if (selectedLayer) { selectedLayer = null; refreshAll(); }
}
function focusCountry(entry: CountryEntry): void {
  try { map.fitBounds(entry.layer.getBounds(), { maxZoom: 6, padding: [40, 40] }); } catch {}
  selectLayer(entry.layer, false); // sidebar click always selects (no toggle)
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function buildSidebar(): void {
  countries.sort((a, b) => a.name.localeCompare(b.name));
  const ul = document.getElementById("country-list")!;
  const countEl = document.getElementById("count")!;
  ul.innerHTML = "";
  countries.forEach((entry) => {
    const li = document.createElement("li");
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
    ul.appendChild(li);
  });
  countEl.textContent = countries.length + " countries";

  const search = document.getElementById("search") as HTMLInputElement;
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    Array.prototype.forEach.call(ul.children, (li: HTMLElement) => {
      const match = (li.dataset.name || "").indexOf(q) !== -1;
      li.style.display = match ? "" : "none";
      if (match) shown++;
    });
    countEl.textContent = shown + " of " + countries.length + " countries";
  });
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
      // but record EVERY feature under its sovereign for sovereignty links.
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
        const entry: CountryEntry = { name, layer: layerP, iso, iso2 };
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
            selectLayer(layerP, true);
          },
        });
      },
    }).addTo(map);

    (map as any).borderLayer = layer;
    buildSidebar();
    placeCountryLabels();
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

map.on("click", () => {        // background click clears selection
  if (suppressMapClick) return; // ignore the click that came from a country
  deselect();
});
map.on("zoomend", updateFlagSizes);

loadBorders();
