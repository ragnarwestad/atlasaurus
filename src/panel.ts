// Detail boxes: the cursor hover panel, the selected-country/continent fact
// panel and the feature detail box (peak/river/lake/city/capital), plus the
// panel-drag and label-click helpers.
import L from "leaflet";
import { wikiUrl, cityWikiUrl, escapeHtml } from "./wiki";
import {
  app, hooks, countries, fmtInt, entryForLayer, loadCountryData,
  type CountryEntry, type RestInfo,
} from "./state";
import { groupOf, SCHEME_LABEL } from "./regions";
import { deselect, computeConnectors } from "./countries";

// --- Hover info panel that floats next to the cursor (flag + name + capital) ---
const hoverInfoEl = document.getElementById("hoverinfo")!;
let lastMouseX = 0, lastMouseY = 0;

function positionHoverInfo(x: number, y: number): void {
  const pad = 12;
  const r = hoverInfoEl.getBoundingClientRect();
  let left = x + 16;            // default: to the lower-right of the cursor
  let top = y + 18;
  if (left + r.width + pad > window.innerWidth) left = x - r.width - 16;   // flip left near right edge
  if (top + r.height + pad > window.innerHeight) top = y - r.height - 18;  // flip up near bottom edge
  hoverInfoEl.style.left = Math.max(pad, left) + "px";
  hoverInfoEl.style.top = Math.max(pad, top) + "px";
}

// Track the cursor so the hover info panel can float next to it (wired to the
// map container's mousemove in main.ts).
export function trackMouse(x: number, y: number): void {
  lastMouseX = x;
  lastMouseY = y;
  if (!hoverInfoEl.hidden) positionHoverInfo(x, y);
}

export function showHoverInfo(e: CountryEntry): void {
  const flag = e.iso2 ? '<img src="https://flagcdn.com/32x24/' + e.iso2 + '.png" alt="">' : "";
  const cap = e.capitalName ? '<span class="hi-cap">· ' + escapeHtml(e.capitalName) + "</span>" : "";
  hoverInfoEl.innerHTML = flag + '<span class="hi-name">' + escapeHtml(e.name) + "</span> " + cap;
  hoverInfoEl.hidden = false;
  positionHoverInfo(lastMouseX, lastMouseY);
}
export function hideHoverInfo(): void {
  hoverInfoEl.hidden = true;
}

// --- Selected-country fact panel (population/GDP/region from Natural Earth,
//     area/currency/languages from mledoze/countries, fetched + cached on select) ---
export const countryInfoEl = document.getElementById("countryinfo")!;

function buildInfoHTML(props: any, entry: CountryEntry | null, extra: RestInfo | null, territories: string[]): string {
  const name = props.FORMAL_EN || props.NAME_LONG || props.ADMIN || (entry && entry.name) || "Unknown";
  const longName = props.NAME_LONG && props.NAME_LONG !== name ? props.NAME_LONG : "";
  const flag = entry && entry.iso2 ? '<img src="https://flagcdn.com/40x30/' + entry.iso2 + '.png" alt="">' : "";
  const rows: [string, string][] = [];
  if (entry && entry.capitalName) {
    rows.push(["Capital", '<a href="' + cityWikiUrl(entry.capitalName) + '" target="_blank" rel="noopener">' +
      escapeHtml(entry.capitalName) + "</a>"]);
  }
  if (props.POP_EST) rows.push(["Population", fmtInt(props.POP_EST) + (props.POP_YEAR ? " (" + props.POP_YEAR + ")" : "")]);
  if (extra && extra.area) rows.push(["Area", fmtInt(extra.area) + " km²"]);
  if (props.GDP_MD) rows.push(["GDP", "$" + fmtInt(props.GDP_MD) + " M" + (props.GDP_YEAR ? " (" + props.GDP_YEAR + ")" : "")]);
  if (extra && extra.currencies) rows.push(["Currency", escapeHtml(extra.currencies)]);
  if (extra && extra.languages) rows.push(["Languages", escapeHtml(extra.languages)]);
  const region = [props.CONTINENT, props.SUBREGION].filter(Boolean).join(" · ");
  if (region) rows.push(["Region", escapeHtml(region)]);
  if (props.INCOME_GRP) rows.push(["Income group", escapeHtml(String(props.INCOME_GRP).replace(/^\d+\.\s*/, ""))]);
  const dl = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");

  let terrBlock = "";
  if (territories.length) {
    const links = territories
      .map((n) => '<a href="' + wikiUrl(n) + '" target="_blank" rel="noopener">' + escapeHtml(n) + "</a>")
      .join(", ");
    terrBlock = '<div class="ci-terr"><div class="ci-terr-h">Territories (' + territories.length +
      ')</div><div class="ci-terr-list">' + links + "</div></div>";
  }

  const titleLink = '<a href="' + wikiUrl(entry ? entry.name : name) + '" target="_blank" rel="noopener">' +
    escapeHtml(name) + ' <span class="ext">↗</span></a>';
  return (
    '<div class="ci-head">' + flag +
      '<div><div class="ci-title">' + titleLink + "</div>" +
        (longName ? '<div class="ci-sub">' + escapeHtml(longName) + "</div>" : "") +
      "</div>" +
      '<button class="ci-toggle" title="Collapse / expand" aria-label="Collapse / expand"><span class="ci-caret"></span></button>' +
      '<button class="ci-close" title="Close" aria-label="Close">×</button>' +
    "</div>" +
    "<dl>" + dl + "</dl>" + terrBlock
  );
}

function renderInfo(props: any, entry: CountryEntry | null, extra: RestInfo | null, territories: string[]): void {
  countryInfoEl.innerHTML = buildInfoHTML(props, entry, extra, territories);
  countryInfoEl.hidden = false;
  const close = countryInfoEl.querySelector(".ci-close");
  if (close) close.addEventListener("click", deselect);
  const toggle = countryInfoEl.querySelector(".ci-toggle");
  if (toggle) toggle.addEventListener("click", () => countryInfoEl.classList.toggle("collapsed"));
  const head = countryInfoEl.querySelector(".ci-head");
  if (head) makeDraggable(countryInfoEl, head as HTMLElement,
    () => countryInfoEl.classList.toggle("collapsed"));
}

// Drag a panel by a handle element, with an optional click handler (fired only
// on a clean click — no drag — that didn't land on a link/button). Links and
// buttons inside the handle still work; dragging switches to top/left so the
// panel stays where it's dropped, clamped to the viewport.
function makeDraggable(panel: HTMLElement, handle: HTMLElement, onClick?: () => void): void {
  handle.addEventListener("mousedown", (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    let moved = false;
    const onMove = (m: MouseEvent) => {
      if (!moved) { moved = true; panel.style.bottom = "auto"; }
      const nx = Math.max(0, Math.min(window.innerWidth - rect.width, m.clientX - offX));
      const ny = Math.max(0, Math.min(window.innerHeight - 36, m.clientY - offY));
      panel.style.left = nx + "px";
      panel.style.top = ny + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!moved && onClick) onClick();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// Detail box for a non-country feature (peak, river, lake, city, capital). The
// Wikipedia link lives here on the title — map labels are plain text — so a stray
// tap on a label (common on mobile) can't open Wikipedia by accident.
export function renderFeatureInfo(title: string, wikiHref: string, sub: string, rows: [string, string][]): void {
  hooks.clearCityOutline(); // a new feature box supersedes any city outline (cityOpen redraws after)
  if (app.selectedLayer || app.selectedContinent) deselect(); // drop any country/region selection
  const titleLink = '<a href="' + wikiHref + '" target="_blank" rel="noopener">' + escapeHtml(title) + ' <span class="ext">↗</span></a>';
  const dl = rows.length ? "<dl>" + rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("") + "</dl>" : "";
  countryInfoEl.classList.remove("collapsed");
  countryInfoEl.style.left = ""; countryInfoEl.style.top = ""; countryInfoEl.style.bottom = "";
  countryInfoEl.innerHTML =
    '<div class="ci-head"><div><div class="ci-title">' + titleLink + "</div>" +
    '<div class="ci-sub">' + escapeHtml(sub) + "</div></div>" +
    '<button class="ci-close" title="Close" aria-label="Close">×</button></div>' + dl;
  countryInfoEl.hidden = false;
  const close = countryInfoEl.querySelector(".ci-close");
  if (close) close.addEventListener("click", () => { countryInfoEl.hidden = true; });
  const head = countryInfoEl.querySelector(".ci-head");
  if (head) makeDraggable(countryInfoEl, head as HTMLElement);
}

// Make a map label clickable (opens the detail box, not Wikipedia) — labels are a
// much bigger tap target than the tiny dots, which matters on mobile.
export function attachLabelClick(tt: L.Tooltip, onClick: () => void): void {
  const el = tt.getElement();
  if (!el) return;
  el.style.pointerEvents = "auto"; // override .map-label { pointer-events: none }
  el.style.cursor = "pointer";
  L.DomEvent.on(el, "click", (ev) => {
    L.DomEvent.stop(ev);
    app.suppressMapClick = true; setTimeout(() => { app.suppressMapClick = false; }, 0);
    onClick();
  });
}

// Bottom panel shows the selected COUNTRY, or the selected CONTINENT, or nothing.
export function updateInfoPanel(): void {
  if (app.mode === "quiz") { countryInfoEl.hidden = true; return; }
  if (app.selectedLayer) { renderCountryInfo(); return; }
  if (app.selectedContinent) { renderContinentInfo(app.selectedContinent); return; }
  countryInfoEl.hidden = true;
  app.currentInfoCode = null;
  app.currentInfoContinent = null;
}

export function isNarrow(): boolean { return window.matchMedia("(max-width: 700px)").matches; }

// On a fresh selection, default the bottom sheet to collapsed on small screens
// (so it doesn't cover the map) and drop any leftover drag offset.
function defaultPanelLayout(isNew: boolean): void {
  if (!isNew) return;
  if (isNarrow()) {
    countryInfoEl.classList.add("collapsed");
    countryInfoEl.style.left = "";
    countryInfoEl.style.top = "";
    countryInfoEl.style.bottom = "";
  } else {
    countryInfoEl.classList.remove("collapsed");
  }
}

function renderCountryInfo(): void {
  app.currentInfoContinent = null;
  const props = ((app.selectedLayer as any).feature && (app.selectedLayer as any).feature.properties) || {};
  const entry = entryForLayer(app.selectedLayer);
  const code: string | null = props.ADM0_A3 || props.adm0_a3 || null;
  const isNew = code !== app.currentInfoCode;
  app.currentInfoCode = code;
  const conn = app.selectedLayer ? computeConnectors(app.selectedLayer) : null;
  const territories = conn ? conn.items.map((i) => i.name).sort((a, b) => a.localeCompare(b)) : [];
  renderInfo(props, entry, (app.countryData && code) ? app.countryData[code] || null : null, territories);
  defaultPanelLayout(isNew);

  // Lazy-load area/currency/languages the first time, then re-render.
  if (!app.countryData) {
    loadCountryData().then((data) => {
      if (app.currentInfoCode === code && app.selectedLayer) renderInfo(props, entry, code ? data[code] || null : null, territories);
    }).catch(() => { /* extra fields optional */ });
  }
}

function renderContinentInfo(name: string): void {
  app.currentInfoCode = null;
  if (name !== app.currentInfoContinent && isNarrow()) {
    // Continent panel has no collapse toggle — just clear any drag offset so it
    // sits as a proper full-width bottom sheet (and isn't a leftover strip).
    countryInfoEl.classList.remove("collapsed");
    countryInfoEl.style.left = "";
    countryInfoEl.style.top = "";
    countryInfoEl.style.bottom = "";
  }
  app.currentInfoContinent = name;
  const members = countries.filter((e) => groupOf(e) === name && !e.isLandmass);
  let pop = 0, gdp = 0, area = 0, topName = "", topPop = -1;
  members.forEach((e) => {
    const p = ((e.layer as any).feature && (e.layer as any).feature.properties) || {};
    if (p.POP_EST) pop += p.POP_EST;
    if (p.GDP_MD) gdp += p.GDP_MD;
    if (p.POP_EST > topPop) { topPop = p.POP_EST; topName = e.name; }
    if (app.countryData && e.iso && app.countryData[e.iso] && app.countryData[e.iso].area) area += app.countryData[e.iso].area as number;
  });
  const rows: [string, string][] = [["Countries", String(members.length)]];
  if (pop) rows.push(["Population", fmtInt(pop)]);
  if (app.countryData && area) rows.push(["Area", fmtInt(area) + " km²"]);
  if (gdp) rows.push(["GDP", "$" + fmtInt(gdp) + " M"]);
  if (topName) rows.push(["Most populous", escapeHtml(topName)]);
  const dl = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  // Link geographic names to Wikipedia; World Bank names ("Latin America &
  // Caribbean" etc.) aren't article titles, so show them as plain text.
  const linkable = name !== "Other" && app.groupScheme !== "wbRegion";
  const titleLink = linkable
    ? '<a href="' + wikiUrl(name) + '" target="_blank" rel="noopener">' + escapeHtml(name) + ' <span class="ext">↗</span></a>'
    : escapeHtml(name);
  countryInfoEl.innerHTML =
    '<div class="ci-head"><div><div class="ci-title">' + titleLink + "</div>" +
    '<div class="ci-sub">' + SCHEME_LABEL[app.groupScheme] + "</div></div>" +
    '<button class="ci-close" title="Close" aria-label="Close">×</button></div>' +
    "<dl>" + dl + "</dl>";
  countryInfoEl.hidden = false;
  const close = countryInfoEl.querySelector(".ci-close");
  if (close) close.addEventListener("click", deselect);

  // Area needs the country dataset; lazy-load then re-render if still showing.
  if (!app.countryData) {
    loadCountryData().then(() => {
      if (app.currentInfoContinent === name && app.selectedContinent === name) renderContinentInfo(name);
    }).catch(() => { /* area optional */ });
  }
}
