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
import { refreshCapitals, scheduleCityUpdate, refreshCities } from "./places";
import { updateRegionLabels } from "./regions";
import { refreshPolygons, refreshConnectors, deselect, loadBorders } from "./countries";
import {
  applyFilter, buildSidebar, buildContinentList,
  setActiveTab, markActiveContinent, initSidebarSections, buildFeatureLists,
} from "./sidebar";
import {
  setMode, nextQuestion, setQuizCat, applyNbMode, applyLocMode, renderNbResults,
  renderLocResults, nbCheckAnswers, nbInput, nbCheck, locInput, quizNextBtn, quizSkipBtn,
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
document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode as "explore" | "quiz"));
});
quizNextBtn.addEventListener("click", () => { if (app.mode === "quiz") nextQuestion(); });
quizSkipBtn.addEventListener("click", () => { if (app.mode === "quiz") nextQuestion(); });
nbInput.addEventListener("input", () => renderNbResults(nbInput.value));
nbCheck.addEventListener("click", nbCheckAnswers);
document.querySelectorAll<HTMLInputElement>('#nb-mode input[name="nbmode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    app.nbMode = r.value === "search" ? "search" : "map";
    applyNbMode();
    if (app.nbMode === "search") nbInput.focus();
  });
});
locInput.addEventListener("input", () => renderLocResults(locInput.value));
document.querySelectorAll<HTMLInputElement>('#loc-mode input[name="locmode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    app.locMode = r.value === "search" ? "search" : "map";
    applyLocMode();
    if (app.locMode === "search" && !app.quizAnswered) locInput.focus();
  });
});
document.querySelectorAll<HTMLElement>(".qt-btn").forEach((b) => {
  b.addEventListener("click", () => {
    app.quizType = b.dataset.qtype as QuizType;
    // Scope the active state to the button's own row (Country vs Mountains).
    b.parentElement!.querySelectorAll<HTMLElement>(".qt-btn").forEach((x) => { x.classList.toggle("active", x === b); });
    if (app.mode === "quiz") nextQuestion();
  });
});
document.querySelectorAll<HTMLElement>(".qc-tab").forEach((b) => {
  b.addEventListener("click", () => setQuizCat(b.dataset.cat as "country" | "continent" | "mountains"));
});

const capToggle = document.getElementById("show-capitals") as HTMLInputElement;
capToggle.addEventListener("change", () => { app.showCapitals = capToggle.checked; refreshCapitals(); });

const flagToggle = document.getElementById("show-flags") as HTMLInputElement;
flagToggle.addEventListener("change", () => { app.showFlags = flagToggle.checked; refreshFlags(); });

const hoverToggle = document.getElementById("show-hover") as HTMLInputElement;
hoverToggle.addEventListener("change", () => { app.showHover = hoverToggle.checked; if (!app.showHover) hideHoverInfo(); });

const mtnToggle = document.getElementById("show-mountains") as HTMLInputElement;
mtnToggle.addEventListener("change", () => { app.showPeaks = mtnToggle.checked; refreshPeaks(); });

const rivToggle = document.getElementById("show-rivers") as HTMLInputElement;
rivToggle.addEventListener("change", () => { app.showRivers = rivToggle.checked; refreshRivers(); });

const lakeToggle = document.getElementById("show-lakes") as HTMLInputElement;
lakeToggle.addEventListener("change", () => { app.showLakes = lakeToggle.checked; refreshLakes(); });

const cityToggle = document.getElementById("show-cities") as HTMLInputElement;
cityToggle.addEventListener("change", () => { app.showCities = cityToggle.checked; refreshCities(); });

const nameToggle = document.getElementById("show-names") as HTMLInputElement;
nameToggle.addEventListener("change", () => { app.showNames = nameToggle.checked; refreshCountryLabels(); });

const regionToggle = document.getElementById("show-regions") as HTMLInputElement;
regionToggle.addEventListener("change", () => setActiveTab(regionToggle.checked ? "continents" : "countries"));


let mapExpanded = true;
function setMapExpanded(on: boolean): void {
  mapExpanded = on;
  document.getElementById("map-group")!.classList.toggle("collapsed", !on);
}
document.querySelector(".sb-fold")!.addEventListener("click", () => setMapExpanded(!mapExpanded));

// Save space on small screens: start with the map options + country list folded.
if (isNarrow()) document.getElementById("feat-sec-countries")?.classList.add("collapsed");
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
const openHelp = () => { helpModal.hidden = false; };
const closeHelp = () => { helpModal.hidden = true; };
document.querySelectorAll<HTMLElement>(".help-btn").forEach((b) => { b.addEventListener("click", openHelp); });
helpModal.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === helpModal || t.classList.contains("help-close")) closeHelp();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelp(); });

// Track the cursor so the hover info panel can float next to it.
map.getContainer().addEventListener("mousemove", (ev: MouseEvent) => trackMouse(ev.clientX, ev.clientY));

initSidebarSections(); // wire the Countries/Regions + Lakes/Mountains/Rivers fold sections
loadPhysicalData();   // populate those lists (peaks now; rivers/lakes when fetched)
loadBorders();
