// App entry point: imports the modules, defines the refreshAll coordinator,
// wires the DOM event listeners and kicks off the data loading.
import "leaflet/dist/leaflet.css";
import "./styles.css";

import L from "leaflet";
import { map } from "./map";
import { app, hooks, loadCountryData, type GroupScheme, type QuizType } from "./state";
import { trackMouse, hideHoverInfo, countryInfoEl, updateInfoPanel, isNarrow } from "./panel";
import { refreshCountryLabels, refreshFlags, updateFlagSizes } from "./labels";
import { refreshPeaks, refreshRivers, refreshLakes, updatePeakSizes, schedulePhysicalUpdate, loadPhysicalData } from "./physical";
import { refreshCapitals, scheduleCityUpdate, refreshCities, loadCityData } from "./places";
import { updateRegionLabels } from "./regions";
import { refreshPolygons, refreshConnectors, deselect, loadBorders } from "./countries";
import {
  applyFilter, buildSidebar, buildContinentList,
  setActiveTab, markActiveContinent, initSidebarSections, buildFeatureLists, setSectionEnabled,
} from "./sidebar";
import {
  setMode, nextQuestion, openQuizSection, renderNbResults,
  renderLocResults, renderNameResults, nbCheckAnswers, nbInput, nbCheck, locInput, nameInput,
  quizNextBtn, quizSkipBtn, quizResetBtn, resetScores,
} from "./quiz";

// ---------------------------------------------------------------------------
// Refresh pipeline
// ---------------------------------------------------------------------------
function refreshAll(): void {
  refreshPolygons();
  refreshConnectors();
  refreshCountryLabels();
  refreshCapitals();
  refreshFlags();
  refreshPeaks();
  refreshRivers();
  refreshLakes();
  refreshCities();
  updateInfoPanel();
  markActiveContinent();
  updateRegionLabels();
}
hooks.refreshAll = refreshAll; // modules trigger full refreshes via this hook
hooks.rebuildFeatureLists = buildFeatureLists; // physical.ts repopulates the lists when its data lands

// ---------------------------------------------------------------------------
// Wire UI + go
// ---------------------------------------------------------------------------
// Map a toggle id (with a "" or "pr-" prefix) to the app flag it drives. Used to
// mirror the active panel's checkboxes into the shared render flags on mode entry
// (Explore and Practice keep separate checkbox sets, hence separate state).
const TOGGLE_MAP: [string, "showNames" | "showCities" | "showFlags" | "showLakes" | "showPeaks" | "showRivers" | "showHover"][] = [
  ["show-names", "showNames"], ["show-cities", "showCities"],
  ["show-flags", "showFlags"], ["show-lakes", "showLakes"], ["show-mountains", "showPeaks"],
  ["show-rivers", "showRivers"], ["show-hover", "showHover"],
];
function mirrorToggles(prefix: string): void {
  for (const [id, prop] of TOGGLE_MAP) {
    const el = document.getElementById(prefix + id) as HTMLInputElement | null;
    app[prop] = !!el?.checked;
  }
}
// Explore and Practice both live "inside" the two top tabs; Quiz tab remembers
// which sub-tab (Practice / Challenge) was last used.
let lastQuizSub: "practice" | "quiz" = "quiz"; // Quiz opens on Challenge by default
function enterMode(m: "explore" | "practice" | "quiz"): void {
  if (m === "explore") mirrorToggles("");        // sync render flags from the active panel…
  else if (m === "practice") mirrorToggles("pr-"); // …before setMode runs the refresh
  setMode(m);
}
document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => {
  b.addEventListener("click", () => enterMode(b.dataset.mode === "explore" ? "explore" : lastQuizSub));
});
document.querySelectorAll<HTMLElement>(".quiz-subtab").forEach((b) => {
  b.addEventListener("click", () => { lastQuizSub = b.dataset.sub === "challenge" ? "quiz" : "practice"; enterMode(lastQuizSub); });
});
quizNextBtn.addEventListener("click", () => { if (app.mode === "quiz") nextQuestion(); });
quizSkipBtn.addEventListener("click", () => { if (app.mode === "quiz") nextQuestion(); });
quizResetBtn.addEventListener("click", resetScores);
nbInput.addEventListener("input", () => renderNbResults(nbInput.value));
nbCheck.addEventListener("click", nbCheckAnswers);
locInput.addEventListener("input", () => renderLocResults(locInput.value));
nameInput.addEventListener("input", () => renderNameResults(nameInput.value));
document.querySelectorAll<HTMLElement>(".qt-btn").forEach((b) => {
  b.addEventListener("click", () => {
    app.quizType = b.dataset.qtype as QuizType;
    // Scope the active state to the button's own row (Country vs Mountains).
    b.parentElement!.querySelectorAll<HTMLElement>(".qt-btn").forEach((x) => { x.classList.toggle("active", x === b); });
    if (app.mode === "quiz") nextQuestion();
  });
});
document.querySelectorAll<HTMLElement>("[data-quiz-sec]").forEach((b) => {
  b.addEventListener("click", () => openQuizSection(b.dataset.quizSec!));
});

const flagToggle = document.getElementById("show-flags") as HTMLInputElement;
flagToggle.addEventListener("change", () => { app.showFlags = flagToggle.checked; refreshFlags(); });

const hoverToggle = document.getElementById("show-hover") as HTMLInputElement;
hoverToggle.addEventListener("change", () => { app.showHover = hoverToggle.checked; if (!app.showHover) hideHoverInfo(); });

const mtnToggle = document.getElementById("show-mountains") as HTMLInputElement;
mtnToggle.addEventListener("change", () => { app.showPeaks = mtnToggle.checked; setSectionEnabled("mountains", mtnToggle.checked); refreshPeaks(); });

const rivToggle = document.getElementById("show-rivers") as HTMLInputElement;
rivToggle.addEventListener("change", () => { app.showRivers = rivToggle.checked; setSectionEnabled("rivers", rivToggle.checked); refreshRivers(); });

const lakeToggle = document.getElementById("show-lakes") as HTMLInputElement;
lakeToggle.addEventListener("change", () => { app.showLakes = lakeToggle.checked; setSectionEnabled("lakes", lakeToggle.checked); refreshLakes(); });

const cityToggle = document.getElementById("show-cities") as HTMLInputElement;
cityToggle.addEventListener("change", () => { app.showCities = cityToggle.checked; setSectionEnabled("cities", cityToggle.checked); refreshCities(); });

const nameToggle = document.getElementById("show-names") as HTMLInputElement;
nameToggle.addEventListener("change", () => { app.showNames = nameToggle.checked; refreshCountryLabels(); });

const regionToggle = document.getElementById("show-regions") as HTMLInputElement;
regionToggle.addEventListener("change", () => { setSectionEnabled("regions", regionToggle.checked); setActiveTab(regionToggle.checked ? "continents" : "countries"); });

// Practice (guess) reveal toggles — its own checkbox set, separate from Explore's.
// No feature lists here, so (unlike Explore) they don't call setSectionEnabled.
const PRACTICE_TOGGLES: [string, "showNames" | "showCities" | "showFlags" | "showLakes" | "showPeaks" | "showRivers" | "showHover", () => void][] = [
  ["pr-show-names", "showNames", refreshCountryLabels],
  ["pr-show-cities", "showCities", refreshCities],
  ["pr-show-flags", "showFlags", refreshFlags],
  ["pr-show-lakes", "showLakes", refreshLakes],
  ["pr-show-mountains", "showPeaks", refreshPeaks],
  ["pr-show-rivers", "showRivers", refreshRivers],
  ["pr-show-hover", "showHover", () => { if (!app.showHover) hideHoverInfo(); }],
];
PRACTICE_TOGGLES.forEach(([id, prop, refresh]) => {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.addEventListener("change", () => { app[prop] = el.checked; refresh(); savePracticeToggles(); });
});

let mapExpanded = true;
function setMapExpanded(on: boolean): void {
  mapExpanded = on;
  document.getElementById("map-group")!.classList.toggle("collapsed", !on);
}
document.querySelector(".sb-fold")!.addEventListener("click", () => setMapExpanded(!mapExpanded));

// Save space on small screens: start with the map options folded too.
setMapExpanded(!isNarrow());

const searchInput = document.getElementById("search") as HTMLInputElement;
const searchClear = document.getElementById("search-clear") as HTMLButtonElement;
function syncSearchClear(): void { searchClear.hidden = searchInput.value === ""; }
searchInput.addEventListener("input", () => { applyFilter(); syncSearchClear(); });
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  applyFilter();
  syncSearchClear();
  searchInput.focus();
});

const sortSelect = document.getElementById("sort") as HTMLSelectElement;
sortSelect.addEventListener("change", () => {
  app.sortBy = sortSelect.value as "name" | "population" | "area";
  // Area needs the country dataset; load it first if sorting by area.
  if (app.sortBy === "area" && !app.countryData) loadCountryData().then(buildSidebar).catch(buildSidebar);
  else buildSidebar();
});

const schemeSelect = document.getElementById("scheme") as HTMLSelectElement;
schemeSelect.addEventListener("change", () => {
  app.groupScheme = schemeSelect.value as GroupScheme;
  // Group names differ per scheme, so any current region selection is stale.
  app.selectedContinent = null;
  app.expandedContinent = null;
  buildContinentList();
  refreshAll();
});

map.on("click", () => {        // background click clears selection / closes panels
  if (app.suppressMapClick) return; // ignore the click that came from a feature
  deselect();
  countryInfoEl.hidden = true;  // also close a feature detail box
});
map.on("zoomend", updateFlagSizes);
map.on("zoomend", updatePeakSizes);
map.on("moveend", scheduleCityUpdate);  // re-render in-view cities after pan/zoom
map.on("moveend", refreshCapitals);     // re-evaluate which capitals fit the view
map.on("moveend", refreshCountryLabels); // re-evaluate which country names fit the view
map.on("moveend", schedulePhysicalUpdate); // reveal more rivers/lakes as you zoom in (deferred; canvas must settle)

// Zoom-level readout, stacked under the +/- control.
const ZoomReadout = L.Control.extend({
  onAdd() {
    const div = L.DomUtil.create("div", "leaflet-bar zoom-level");
    div.title = "Zoom level";
    const update = () => { const z = map.getZoom(); div.textContent = Number.isInteger(z) ? String(z) : z.toFixed(1); };
    map.on("zoomend", update);
    update();
    return div;
  },
});
new ZoomReadout({ position: "topleft" }).addTo(map);

// About / help modal.
const helpModal = document.getElementById("help-modal") as HTMLElement;
const helpTabs = helpModal.querySelectorAll<HTMLElement>(".help-tab");
const helpPanels = helpModal.querySelectorAll<HTMLElement>(".help-panel");
function setHelpTab(name: string): void {
  helpTabs.forEach((t) => {
    const on = t.dataset.helpTab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  helpPanels.forEach((p) => { p.hidden = p.dataset.helpPanel !== name; });
}
helpTabs.forEach((t) => { t.addEventListener("click", () => setHelpTab(t.dataset.helpTab || "explore")); });
// Open on whichever section matches the sidebar's current mode.
const openHelp = () => { setHelpTab(app.mode === "explore" ? "explore" : "quiz"); helpModal.hidden = false; };
const closeHelp = () => { helpModal.hidden = true; };
document.querySelectorAll<HTMLElement>(".help-btn").forEach((b) => { b.addEventListener("click", openHelp); });
helpModal.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === helpModal || t.classList.contains("help-close")) closeHelp();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });

// Track the cursor so the hover info panel can float next to it.
map.getContainer().addEventListener("mousemove", (ev: MouseEvent) => trackMouse(ev.clientX, ev.clientY));

// ---------------------------------------------------------------------------
// Persist the toggle panels across sessions (localStorage). Explore and Practice
// keep SEPARATE sets. On startup the Explore set is applied immediately (it is
// the active panel); Practice's saved values are loaded into its checkboxes and
// take effect when you switch to Practice (mirrorToggles).
// ---------------------------------------------------------------------------
const EXPLORE_TOGGLE_IDS = [
  "show-names", "show-cities", "show-regions", "show-lakes", "show-mountains",
  "show-rivers", "show-flags", "show-hover",
];
const PRACTICE_TOGGLE_IDS = [
  "pr-show-names", "pr-show-cities", "pr-show-lakes", "pr-show-mountains",
  "pr-show-rivers", "pr-show-flags", "pr-show-hover",
];
const EXPLORE_KEY = "atlasaurus.toggles", PRACTICE_KEY = "atlasaurus.toggles.practice";
function saveSet(key: string, ids: string[]): void {
  const state: Record<string, boolean> = {};
  ids.forEach((id) => { state[id] = !!(document.getElementById(id) as HTMLInputElement | null)?.checked; });
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage unavailable */ }
}
function saveToggles(): void { saveSet(EXPLORE_KEY, EXPLORE_TOGGLE_IDS); }
function savePracticeToggles(): void { saveSet(PRACTICE_KEY, PRACTICE_TOGGLE_IDS); }
function applyStored(key: string, ids: string[]): void { // set checkboxes from storage (HTML default otherwise)
  let state: Record<string, boolean> = {};
  try { state = JSON.parse(localStorage.getItem(key) || "{}"); } catch { return; }
  ids.forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && id in state) el.checked = !!state[id]; });
}
EXPLORE_TOGGLE_IDS.forEach((id) => document.getElementById(id)?.addEventListener("change", saveToggles));

initSidebarSections(); // wire the Countries/Regions + Cities/Lakes/Mountains/Rivers fold sections
applyStored(EXPLORE_KEY, EXPLORE_TOGGLE_IDS);
applyStored(PRACTICE_KEY, PRACTICE_TOGGLE_IDS);
// Apply the Explore toggles' effects now (Explore is the active panel at startup).
EXPLORE_TOGGLE_IDS.forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el?.checked) el.dispatchEvent(new Event("change")); });
loadPhysicalData();   // populate those lists (peaks now; rivers/lakes when fetched)
loadCityData();       // populate the Cities list (independent of the Cities map layer)
loadBorders();
