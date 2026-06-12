// Sidebar: the Countries/Regions tabs, the flat country list, the continent
// list with expandable members, search filter, sorting and fold state.
import { wikiUrl, escapeHtml } from "./wiki";
import { map } from "./map";
import {
  app, hooks, countries, realCountries, popOf, areaOf, CONTINENT_ORDER,
  type CountryEntry,
} from "./state";
import { groupOf, rebuildRegionColors } from "./regions";
import { selectLayer, selectContinent, deselect } from "./countries";
import { peakList, riverList, lakeList, type PhysFeature } from "./physical";
import { cityList } from "./places";

export function focusCountry(entry: CountryEntry): void {
  try { map.fitBounds(entry.layer.getBounds(), { maxZoom: 6, padding: [40, 40] }); } catch {}
  selectLayer(entry.layer, false); // sidebar click always selects (no toggle)
}


// Compact value with 2 decimals + magnitude suffix, e.g. 1.41B, 5.43M, 323.80K.
function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
// The value shown in parentheses for the current sort (empty when sorting by name).
function metricLabel(value: number): string {
  if (app.sortBy === "population") return " (" + formatCompact(value) + ")";
  if (app.sortBy === "area") return " (" + formatCompact(value) + " km²)";
  return "";
}

// Comparator for the current sort: population/area descending, else A–Z.
function cmpCountries(a: CountryEntry, b: CountryEntry): number {
  if (app.sortBy === "population") return popOf(b) - popOf(a) || a.name.localeCompare(b.name);
  if (app.sortBy === "area") return areaOf(b) - areaOf(a) || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name);
}

function makeCountryLi(entry: CountryEntry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "country";
  li.dataset.name = entry.name.toLowerCase();

  const label = document.createElement("span");
  label.textContent = entry.name;
  label.title = "Zoom to " + entry.name + " on the map";
  label.style.flex = "1";
  label.addEventListener("click", () => focusCountry(entry));
  if (app.sortBy !== "name") {
    const m = document.createElement("span");
    m.className = "metric";
    m.textContent = metricLabel(app.sortBy === "population" ? popOf(entry) : areaOf(entry));
    label.appendChild(m);
  }

  const wiki = document.createElement("a");
  wiki.textContent = "Wiki ↗";
  wiki.href = wikiUrl(entry.name);
  wiki.target = "_blank";
  wiki.rel = "noopener";

  li.appendChild(label);
  li.appendChild(wiki);
  return li;
}

// Filter the flat country list by the search box; update the Countries tab count.
export function applyFilter(): void {
  const ul = document.getElementById("country-list")!;
  const search = document.getElementById("search") as HTMLInputElement;
  const q = search.value.trim().toLowerCase();
  const total = realCountries().length;
  let shown = 0;
  ul.querySelectorAll<HTMLElement>("li.country").forEach((li) => {
    const matches = (li.dataset.name || "").indexOf(q) !== -1;
    if (matches) shown++;
    li.style.display = matches ? "" : "none";
  });
  const countNum = document.getElementById("count-num")!;
  countNum.textContent = q ? shown + " of " + total : String(total);
}

// Highlight the active continent header (the one shown on the map).
export function markActiveContinent(): void {
  document.querySelectorAll<HTMLElement>("#continent-list li.cont-head").forEach((h) => {
    h.classList.toggle("active", h.dataset.group === app.selectedContinent);
  });
}

// Continents tab: each continent is a header; the expanded one lists its
// member countries beneath. Clicking a header expands it AND highlights the
// continent on the map; clicking a member selects that single country.
export function buildContinentList(): void {
  rebuildRegionColors();
  const counts: Record<string, number> = {};
  const byCont: Record<string, CountryEntry[]> = {};
  countries.forEach((e) => {
    const g = groupOf(e);
    if (e.isLandmass) { counts[g] = counts[g] || 0; return; } // list the group, 0 countries
    counts[g] = (counts[g] || 0) + 1;
    (byCont[g] = byCont[g] || []).push(e);
  });
  const order = Object.keys(counts);
  if (app.sortBy === "name") {
    order.sort((a, b) => {
      const ia = CONTINENT_ORDER.indexOf(a), ib = CONTINENT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  } else {
    // Sort continents by total population / area of their members (descending).
    const metric = (g: string) => (byCont[g] || []).reduce((s, e) => s + (app.sortBy === "population" ? popOf(e) : areaOf(e)), 0);
    order.sort((a, b) => metric(b) - metric(a) || a.localeCompare(b));
  }

  const cl = document.getElementById("continent-list")!;
  cl.innerHTML = "";
  order.forEach((g) => {
    const head = document.createElement("li");
    head.className = "cont-head" + (app.expandedContinent === g ? " expanded" : "") +
      (app.selectedContinent === g ? " active" : "");
    head.dataset.group = g;
    head.title = "Show all of " + g + " on the map";
    const total = app.sortBy === "name" ? 0
      : (byCont[g] || []).reduce((s, e) => s + (app.sortBy === "population" ? popOf(e) : areaOf(e)), 0);
    const metric = app.sortBy === "name" ? "" : '<span class="metric">' + metricLabel(total) + "</span>";
    const hue = app.regionHue[g];
    const sw = hue != null ? '<span class="cont-swatch" style="background:hsl(' + hue + ',60%,62%)"></span>' : "";
    head.innerHTML = '<span class="cont-name"><span class="caret">▾</span>' + sw + escapeHtml(g) + metric +
      '</span><span class="cnt">' + counts[g] + "</span>";
    head.addEventListener("click", () => {
      if (app.expandedContinent === g) { app.expandedContinent = null; deselect(); }
      else { app.expandedContinent = g; selectContinent(g); }
      buildContinentList();
    });
    cl.appendChild(head);

    if (app.expandedContinent === g) {
      (byCont[g] || []).slice().sort(cmpCountries).forEach((entry) => {
        const li = makeCountryLi(entry);
        li.classList.add("cont-member");
        cl.appendChild(li);
      });
    }
  });
  document.getElementById("cont-num")!.textContent = String(order.length);
}

export function buildSidebar(): void {
  // Flat country list (Countries tab) — excludes the Antarctica landmass.
  const ul = document.getElementById("country-list")!;
  ul.innerHTML = "";
  realCountries().sort(cmpCountries).forEach((entry) => { ul.appendChild(makeCountryLi(entry)); });
  document.getElementById("count-num")!.textContent = String(realCountries().length);

  buildContinentList();
  applyFilter();
}

// ---------------------------------------------------------------------------
// Physical-feature lists: Lakes / Mountains / Rivers (collapsible, searchable)
// ---------------------------------------------------------------------------
// `dynamic` sections (Cities) have too many entries to pre-render, so they show a
// capped, population-ranked slice and re-render matches as you type.
const FEATURE_SECTIONS: { id: string; list: () => PhysFeature[]; dynamic?: boolean }[] = [
  { id: "cities", list: () => cityList, dynamic: true },
  { id: "lakes", list: () => lakeList },
  { id: "mountains", list: () => peakList },
  { id: "rivers", list: () => riverList },
];
const DYNAMIC_CAP = 200; // max rows rendered for a dynamic list

function makeFeatureLi(f: PhysFeature): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "feat-item";
  li.dataset.name = f.name.toLowerCase();

  const label = document.createElement("span");
  label.textContent = f.name;
  label.title = "Zoom to " + f.name + " on the map";
  label.style.flex = "1";
  label.addEventListener("click", () => f.focus());

  const wiki = document.createElement("a");
  wiki.textContent = "Wiki ↗";
  wiki.href = f.wiki;
  wiki.target = "_blank";
  wiki.rel = "noopener";

  li.appendChild(label);
  li.appendChild(wiki);
  return li;
}

// Dynamic (large) list: filter the full data, render up to DYNAMIC_CAP rows in the
// data's existing order (population-ranked), and report the match count.
function renderDynamicList(id: string, full: PhysFeature[]): void {
  const ul = document.getElementById("feat-list-" + id);
  const search = document.getElementById("feat-search-" + id) as HTMLInputElement | null;
  const countEl = document.getElementById("feat-count-" + id);
  if (!ul) return;
  const q = (search?.value || "").trim().toLowerCase();
  const matches = q ? full.filter((f) => f.name.toLowerCase().indexOf(q) !== -1) : full;
  ul.innerHTML = "";
  matches.slice(0, DYNAMIC_CAP).forEach((f) => ul.appendChild(makeFeatureLi(f)));
  if (countEl) {
    countEl.textContent = !q ? String(full.length)
      : (matches.length > DYNAMIC_CAP ? DYNAMIC_CAP + "+" : String(matches.length)) + " of " + full.length;
  }
}

// Apply a section's search box to its list + update its header count.
function applyFeatureFilter(id: string): void {
  const sec = FEATURE_SECTIONS.find((s) => s.id === id);
  if (sec?.dynamic) { renderDynamicList(id, sec.list()); return; }
  const ul = document.getElementById("feat-list-" + id);
  const search = document.getElementById("feat-search-" + id) as HTMLInputElement | null;
  const countEl = document.getElementById("feat-count-" + id);
  if (!ul || !search) return;
  const q = search.value.trim().toLowerCase();
  const items = ul.querySelectorAll<HTMLElement>("li.feat-item");
  let shown = 0;
  items.forEach((li) => {
    const m = (li.dataset.name || "").indexOf(q) !== -1;
    if (m) shown++;
    li.style.display = m ? "" : "none";
  });
  if (countEl) countEl.textContent = q ? shown + " of " + items.length : String(items.length);
}

// (Re)render every list from the current data (called once on startup and again
// when lazily-fetched data — cities/rivers/lakes — arrives).
export function buildFeatureLists(): void {
  FEATURE_SECTIONS.forEach((sec) => {
    if (sec.dynamic) { renderDynamicList(sec.id, sec.list()); return; }
    const ul = document.getElementById("feat-list-" + sec.id);
    if (!ul) return;
    ul.innerHTML = "";
    sec.list().slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => ul.appendChild(makeFeatureLi(f)));
    applyFeatureFilter(sec.id);
  });
}

// Wire the collapse headers + search boxes once (DOM is static scaffolding).
export function initFeatureLists(): void {
  FEATURE_SECTIONS.forEach((sec) => {
    const secEl = document.getElementById("feat-sec-" + sec.id);
    document.getElementById("feat-head-" + sec.id)?.addEventListener("click", () => secEl?.classList.toggle("collapsed"));
    document.getElementById("feat-search-" + sec.id)?.addEventListener("input", () => applyFeatureFilter(sec.id));
  });
  buildFeatureLists();
}

// Region mode (map tint + region labels + scoped toggles) follows whether the
// Regions section is open. Expanding it = "continents", collapsing = "countries".
export function setActiveTab(tab: "countries" | "continents"): void {
  app.activeTab = tab;
  // Each mode owns its selection type — clear the other's so a continent highlight
  // doesn't linger in country mode (and vice versa).
  if (tab === "countries") { app.selectedContinent = null; app.expandedContinent = null; }
  else { app.selectedLayer = null; }
  buildContinentList();   // reflect cleared expand/selection state
  hooks.refreshAll();     // restyle map, panels, reveals (toggle scope depends on mode)
}

// Wire the Countries (cosmetic) and Regions (drives region mode) fold headers,
// then the physical-feature lists.
export function initSidebarSections(): void {
  const countriesSec = document.getElementById("feat-sec-countries");
  document.getElementById("feat-head-countries")?.addEventListener("click", () => countriesSec?.classList.toggle("collapsed"));

  const regionsSec = document.getElementById("feat-sec-regions");
  document.getElementById("feat-head-regions")?.addEventListener("click", () => regionsSec?.classList.toggle("collapsed"));

  initFeatureLists();
}
