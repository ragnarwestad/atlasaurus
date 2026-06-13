// Quiz mode: question generation and scoring for all rounds (name / flag /
// capital / spot / neighbour / continent / mountain peaks), the answer
// handlers, the reveal dots/lines on the map, and Explore↔Quiz mode switching.
import L from "leaflet";
import type { LatLng } from "./geo";
import { wikiUrl, cityWikiUrl, escapeHtml } from "./wiki";
import { PEAKS } from "./peaks";
import { map, quizLayer, quizContLayer } from "./map";
import {
  app, hooks, byIso, realCountries, layerCenter, fmtInt, loadCountryData,
  type CountryEntry, type QuizType,
} from "./state";
import { hideHoverInfo } from "./panel";
import {
  peakIcon, peakCountryNames, riverQuizPool, lakeQuizPool, riversReady, lakesReady,
  loadRiverData, loadLakeData, type WaterQuizItem,
} from "./physical";
import { cityQuizPool, cityDataReady, loadCityData } from "./places";
import { CONTINENT_LABEL_POS } from "./regions";
import { refreshPolygons } from "./countries";

const quizPromptEl = document.getElementById("quiz-prompt")!;
const quizFeedbackEl = document.getElementById("quiz-feedback")!;
const quizScoreEl = document.getElementById("quiz-score")!;
const quizChoicesEl = document.getElementById("quiz-choices")!;
export const quizNextBtn = document.getElementById("quiz-next") as HTMLButtonElement;
export const quizSkipBtn = document.getElementById("quiz-skip") as HTMLButtonElement;

function renderQuizPrompt(): void {
  if (app.quizType === "peakname") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">peak</span> <span>Which mountain?</span>';
    return;
  }
  if (app.quizType === "peakcountry") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">peak</span> <span>' + escapeHtml(app.quizPeak ? app.quizPeak.name : "") + "</span>";
    return;
  }
  if (app.quizType === "cityname") {
    // "Name it": the city is marked on the map; pick its name (don't reveal it).
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">city</span> <span>Which city?</span>';
    return;
  }
  if (app.quizType === "citycountry") {
    // "Which country": show the city name; the country is the answer, so hide it.
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">city</span> <span>' + escapeHtml(app.quizCity ? app.quizCity.name : "") + "</span>";
    return;
  }
  if (app.quizType === "rivername") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">river</span> <span>Which river?</span>';
    return;
  }
  if (app.quizType === "lakename") {
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">lake</span> <span>Which lake?</span>';
    return;
  }
  if (!app.quizTarget) { quizPromptEl.innerHTML = ""; return; }
  if (app.quizType === "flag") {
    // Flag quiz: show only the flag (no name) — identify it and click it.
    quizPromptEl.innerHTML = app.quizTarget.iso2
      ? '<img class="quiz-bigflag" src="https://flagcdn.com/96x72/' + app.quizTarget.iso2 + '.png" alt="Flag">'
      : "(no flag available)";
  } else if (app.quizType === "capital") {
    // Capital quiz: show the capital city; click its country.
    quizPromptEl.innerHTML = app.quizTarget.capitalName
      ? '<span class="quiz-cap-tag">capital</span> <span>' + escapeHtml(app.quizTarget.capitalName) + "</span>"
      : "(no capital)";
  } else if (app.quizType === "continent" || app.quizType === "neighbour") {
    // Show the country (flag + name); pick its continent / click a neighbour.
    const flag = app.quizTarget.iso2 ? '<img src="https://flagcdn.com/40x30/' + app.quizTarget.iso2 + '.png" alt="">' : "";
    quizPromptEl.innerHTML = flag + "<span>" + escapeHtml(app.quizTarget.name) + "</span>";
  } else if (app.quizType === "spot") {
    // Spot quiz: the country is highlighted/pinned on the map — naming it is the
    // task, so the prompt must NOT reveal the name.
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">pinned</span> <span>Which country?</span>';
  } else {
    // Name quiz: just the name (no flag — that would give it away).
    quizPromptEl.innerHTML = "<span>" + escapeHtml(app.quizTarget.name) + "</span>";
  }
}
function renderQuizScore(): void {
  quizScoreEl.textContent = app.quizTotal ? "Score: " + app.quizCorrect + " / " + app.quizTotal : "";
}
// Neighbouring countries (mledoze `borders`, resolved to entries we have).
function neighbourEntries(entry: CountryEntry): CountryEntry[] {
  const codes = (app.countryData && entry.iso && app.countryData[entry.iso] && app.countryData[entry.iso].borders) || [];
  return codes.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
}

// Reset the map to the "locate a country" UI (used by Spot and by name/flag/capital):
// hide the choice/neighbour boxes, clear and show the search box.
function setupLocateBox(): void {
  quizChoicesEl.hidden = true;
  quizContLayer.clearLayers();
  nbBox.hidden = true;
  nameBox.hidden = true;
  locInput.value = ""; locInput.disabled = false;
  locResults.innerHTML = "";
  locBox.hidden = false;
}

export function nextQuestion(): void {
  // The neighbour quiz needs the borders dataset; load it first if necessary.
  if (app.quizType === "neighbour" && !app.countryData) {
    loadCountryData().then(() => nextQuestion()).catch(() => { /* ignore */ });
    return;
  }
  if (app.quizType === "peakname" || app.quizType === "peakcountry") { nextPeakQuestion(); return; }
  if (app.quizType === "cityname" || app.quizType === "citycountry") {
    // The cities dataset is fetched lazily; load it first if necessary.
    if (!cityDataReady()) {
      loadCityData().then(() => { if (app.mode === "quiz" && (app.quizType === "cityname" || app.quizType === "citycountry")) nextQuestion(); }).catch(() => { /* ignore */ });
      return;
    }
    nextCityQuestion();
    return;
  }
  if (app.quizType === "rivername" || app.quizType === "lakename") {
    // Rivers/lakes are fetched lazily; load first if necessary, then retry.
    const ready = app.quizType === "rivername" ? riversReady() : lakesReady();
    if (!ready) {
      const load = app.quizType === "rivername" ? loadRiverData() : loadLakeData();
      load.then(() => { if (app.mode === "quiz" && (app.quizType === "rivername" || app.quizType === "lakename")) nextQuestion(); }).catch(() => { /* ignore */ });
      return;
    }
    nextWaterQuestion();
    return;
  }
  // Restrict the pool to countries that have what the prompt needs.
  const pool = app.quizType === "flag" ? realCountries().filter((c) => c.iso2)
    : app.quizType === "capital" ? realCountries().filter((c) => c.capitalName)
    : app.quizType === "neighbour" ? realCountries().filter((c) => neighbourEntries(c).length > 0)
    : realCountries();
  if (!pool.length) return;
  let t = app.quizTarget;
  for (let i = 0; i < 20 && (!t || t === app.quizTarget); i++) t = pool[Math.floor(Math.random() * pool.length)];
  app.quizTarget = t;
  app.quizGuess = null;
  app.quizAnswered = false;
  app.quizContCorrect = null;
  app.quizContWrong = null;
  app.quizNeighbourSet = app.quizType === "neighbour" && t ? new Set(neighbourEntries(t)) : new Set();
  quizLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (app.quizType === "continent") {
    showContinentLabels();
    quizChoicesEl.hidden = true;
    nbBox.hidden = true;
    locBox.hidden = true;
    nameBox.hidden = true;
    quizFeedbackEl.textContent = "Click any country in its continent on the map.";
  } else if (app.quizType === "neighbour") {
    quizChoicesEl.hidden = true;
    locBox.hidden = true;
    nameBox.hidden = true;
    quizContLayer.clearLayers();
    app.nbSelected = new Set();
    nbInput.value = ""; nbInput.disabled = false;
    nbResults.innerHTML = "";
    renderNbChips();
    nbCheck.disabled = false;
    nbBox.hidden = false;
    applyNbMode();
  } else if (app.quizType === "spot") {
    // Spot: highlight + drop a pin on a random country; the user names it by
    // search. Reset to the world view so the pin is always on screen.
    setupLocateBox();
    locModeEl.hidden = true;     // always answered by typing the name
    app.locMode = "search";
    applyLocMode();
    const c = app.quizTarget ? layerCenter(app.quizTarget) : null;
    map.setView([20, 0], 2);
    if (c) L.circleMarker(c, { radius: 9, color: "#8a3b00", weight: 3, fillColor: "#e8740c", fillOpacity: 0.9 }).addTo(quizLayer);
    quizFeedbackEl.textContent = "Which country is highlighted? Type its name.";
  } else {
    setupLocateBox();
    // "By name" already gives you the name, so searching for it is pointless —
    // hide the mode picker and force map clicks. Flag/capital keep both options.
    const nameOnly = app.quizType === "name";
    locModeEl.hidden = nameOnly;
    if (nameOnly) {
      app.locMode = "map";
      const mapRadio = document.querySelector<HTMLInputElement>('#loc-mode input[value="map"]');
      if (mapRadio) mapRadio.checked = true;
    }
    applyLocMode();
  }
  quizNextBtn.disabled = true;
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Mountain-peak quiz (Name it / Which country)
// ---------------------------------------------------------------------------
function drawQuizPeak(withLabel: boolean): void {
  quizLayer.clearLayers();
  if (!app.quizPeak) return;
  const m = L.marker([app.quizPeak.lat, app.quizPeak.lng], { icon: peakIcon(map.getZoom(), true), keyboard: false });
  if (withLabel) {
    m.bindTooltip('<a href="' + wikiUrl(app.quizPeak.wiki || app.quizPeak.name) + '" target="_blank" rel="noopener">' +
      escapeHtml(app.quizPeak.name) + "</a>", { permanent: true, direction: "top", interactive: true, className: "map-label" });
  }
  m.addTo(quizLayer);
}
function nextPeakQuestion(): void {
  const pool = app.quizType === "peakcountry" ? PEAKS.filter((p) => p.iso.length) : PEAKS;
  if (!pool.length) return;
  let p = app.quizPeak;
  for (let i = 0; i < 20 && (!p || p === app.quizPeak); i++) p = pool[Math.floor(Math.random() * pool.length)];
  app.quizPeak = p;
  app.quizTarget = null; app.quizGuess = null; app.quizAnswered = false;
  app.quizContCorrect = null; app.quizContWrong = null; app.quizNeighbourSet = new Set();
  nbBox.hidden = true; quizChoicesEl.hidden = true;
  quizContLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (app.quizType === "peakname") {
    // Name it: the peak is marked; identify it by searching the name.
    locBox.hidden = true;
    setupNameBox();
    quizFeedbackEl.textContent = "Which mountain is marked? Search and pick it.";
    if (app.quizPeak) map.setView([app.quizPeak.lat, app.quizPeak.lng], 4);
    drawQuizPeak(false);
  } else {
    // Which country: no marker (it would give the answer away) — click the
    // country on the map or search-and-select it from a neutral world view.
    setupCountryAnswerBox();
  }
  quizNextBtn.disabled = true;
  refreshPolygons();
}
function handlePeakNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !app.quizPeak) return;
  app.quizAnswered = true; app.quizTotal++;
  const ok = name === app.quizPeak.name;
  if (ok) app.quizCorrect++;
  nameInput.disabled = true; nameResults.innerHTML = "";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "✓ Correct! " : "✗ It's ") + app.quizPeak.name +
    " — " + fmtInt(app.quizPeak.elevation) + " m, " + peakCountryNames(app.quizPeak) + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawQuizPeak(true);
}
export function handlePeakCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || app.quizType !== "peakcountry" || app.quizAnswered || !app.quizPeak || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true; app.quizTotal++;
  const ok = !!entry.iso && app.quizPeak.iso.includes(entry.iso);
  if (ok) app.quizCorrect++;
  const names = peakCountryNames(app.quizPeak);
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + app.quizPeak.name + " is in " + names + "."
    : "✗ That's " + entry.name + ". " + app.quizPeak.name + " is in " + names + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true; locResults.innerHTML = "";
  drawQuizPeak(true);                          // reveal where the peak actually is
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Cities quiz (mirrors the mountain-peak rounds): "Name it" marks the city and
// you search its name; "Which country" names the city (no marker) and you click
// or search its country. Pool comes from places.ts.
// ---------------------------------------------------------------------------
function drawQuizCity(withLabel: boolean): void {
  quizLayer.clearLayers();
  const c = app.quizCity;
  if (!c) return;
  const m = L.circleMarker([c.lat, c.lng], { radius: 7, color: "#8a3b00", weight: 3, fillColor: "#e8740c", fillOpacity: 0.9 });
  if (withLabel) {
    m.bindTooltip('<a href="' + cityWikiUrl(c.name) + '" target="_blank" rel="noopener">' + escapeHtml(c.name) + "</a>",
      { permanent: true, direction: "top", interactive: true, className: "map-label quiz-label quiz-label-target" });
  }
  m.addTo(quizLayer);
}
function nextCityQuestion(): void {
  // "Which country" needs cities whose country resolves to a map entry.
  const pool = app.quizType === "citycountry"
    ? cityQuizPool().filter((c) => c.iso && byIso[c.iso])
    : cityQuizPool();
  if (!pool.length) return;
  let c = app.quizCity;
  for (let i = 0; i < 20 && (!c || c === app.quizCity); i++) c = pool[Math.floor(Math.random() * pool.length)];
  app.quizCity = c;
  app.quizTarget = null; app.quizPeak = null; app.quizGuess = null; app.quizAnswered = false;
  app.quizContCorrect = null; app.quizContWrong = null; app.quizNeighbourSet = new Set();
  nbBox.hidden = true; quizChoicesEl.hidden = true;
  quizContLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (app.quizType === "cityname") {
    // Name it: the city is marked; identify it by searching the name.
    locBox.hidden = true;
    setupNameBox();
    quizFeedbackEl.textContent = "Which city is marked? Search and pick it.";
    if (c) map.setView([c.lat, c.lng], 5);
    drawQuizCity(false);
  } else {
    // Which country: no marker — click the country on the map or search-select it.
    setupCountryAnswerBox();
  }
  quizNextBtn.disabled = true;
  refreshPolygons();
}
function handleCityNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !app.quizCity) return;
  app.quizAnswered = true; app.quizTotal++;
  const ok = name === app.quizCity.name;
  if (ok) app.quizCorrect++;
  nameInput.disabled = true; nameResults.innerHTML = "";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "✓ Correct! " : "✗ It's ") + app.quizCity.name +
    (app.quizCity.adm0 ? ", " + app.quizCity.adm0 : "") + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawQuizCity(true);
}
export function handleCityCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || app.quizType !== "citycountry" || app.quizAnswered || !app.quizCity || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true; app.quizTotal++;
  const ok = !!app.quizCity.iso && entry.iso === app.quizCity.iso;
  if (ok) app.quizCorrect++;
  const where = byIso[app.quizCity.iso];
  const countryName = (where && where.name) || app.quizCity.adm0 || "another country";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + app.quizCity.name + " is in " + countryName + "."
    : "✗ That's " + entry.name + ". " + app.quizCity.name + " is in " + countryName + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true; locResults.innerHTML = "";
  drawQuizCity(true);                          // reveal where the city actually is
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Rivers / Lakes quiz ("Name it" only — no country data, often multi-country):
// the feature's geometry is highlighted on the map (no label); search its name.
// ---------------------------------------------------------------------------
let quizWaterTarget: WaterQuizItem | null = null;
function drawWaterHighlight(item: WaterQuizItem, withLabel: boolean): void {
  quizLayer.clearLayers();
  const isLake = app.quizType === "lakename";
  item.layers.forEach((layer) => {
    const ll = (layer as any).getLatLngs();
    const shape = isLake
      ? L.polygon(ll, { color: "#8a3b00", weight: 2, fillColor: "#e8740c", fillOpacity: 0.5 })
      : L.polyline(ll, { color: "#e8740c", weight: 4, opacity: 0.95 });
    shape.addTo(quizLayer);
  });
  if (withLabel) {
    L.tooltip({ permanent: true, direction: "top", interactive: true, className: "map-label quiz-label quiz-label-target" })
      .setLatLng(item.bounds.getCenter())
      .setContent('<a href="' + wikiUrl(item.name) + '" target="_blank" rel="noopener">' + escapeHtml(item.name) + "</a>")
      .addTo(quizLayer);
  }
}
function nextWaterQuestion(): void {
  const pool = app.quizType === "rivername" ? riverQuizPool() : lakeQuizPool();
  if (!pool.length) return;
  let item = quizWaterTarget;
  for (let i = 0; i < 20 && (!item || item === quizWaterTarget); i++) item = pool[Math.floor(Math.random() * pool.length)];
  quizWaterTarget = item;
  app.quizTarget = null; app.quizPeak = null; app.quizCity = null; app.quizGuess = null; app.quizAnswered = false;
  app.quizContCorrect = null; app.quizContWrong = null; app.quizNeighbourSet = new Set();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  setupNameBox();
  quizFeedbackEl.textContent = app.quizType === "rivername"
    ? "Which river is highlighted? Search and pick it."
    : "Which lake is highlighted? Search and pick it.";
  if (item) {
    drawWaterHighlight(item, false);
    try { map.fitBounds(item.bounds, { maxZoom: 7, padding: [40, 40] }); } catch { /* ignore */ }
  }
  quizNextBtn.disabled = true;
  refreshPolygons();
}
function handleWaterNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !quizWaterTarget) return;
  app.quizAnswered = true; app.quizTotal++;
  const ok = name === quizWaterTarget.name;
  if (ok) app.quizCorrect++;
  nameInput.disabled = true; nameResults.innerHTML = "";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "✓ Correct! " : "✗ It's ") + quizWaterTarget.name + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawWaterHighlight(quizWaterTarget, true);   // reveal the name on the map
}

function showContinentLabels(): void {
  quizContLayer.clearLayers();
  const present = Array.from(new Set(realCountries().map((c) => c.continent || "Other"))).filter((c) => c !== "Other");
  present.forEach((c) => {
    const pos = CONTINENT_LABEL_POS[c];
    if (!pos) return;
    L.tooltip({ permanent: true, direction: "center", interactive: false, className: "map-label quiz-cont-label" })
      .setLatLng(pos).setContent(escapeHtml(c)).addTo(quizContLayer);
  });
}

export function answerContinent(name: string): void {
  if (app.mode !== "quiz" || app.quizType !== "continent" || !app.quizTarget || app.quizAnswered) return;
  app.quizAnswered = true;
  app.quizTotal++;
  const correct = app.quizTarget.continent || "Other";
  const ok = name === correct;
  if (ok) app.quizCorrect++;
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const c = btn.dataset.continent;
    if (c === correct) btn.classList.add("correct");
    else if (c === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + app.quizTarget.name + " is in " + correct + "."
    : "✗ " + app.quizTarget.name + " is in " + correct + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Colour the correct continent green (and the guessed one red) on the map,
  // and mark where the country itself is.
  app.quizContCorrect = correct;
  app.quizContWrong = ok ? null : name;
  refreshPolygons();
  quizLayer.clearLayers();
  const c = layerCenter(app.quizTarget);
  if (c) addQuizDot(app.quizTarget, c, "correct");
}

// --- Neighbour quiz: pick all bordering countries (search box + map clicks),
//     then Check ---
const nbBox = document.getElementById("nb-box") as HTMLElement;
export const nbInput = document.getElementById("nb-input") as HTMLInputElement;
const nbResults = document.getElementById("nb-results")!;
const nbChips = document.getElementById("nb-chips")!;
export const nbCheck = document.getElementById("nb-check") as HTMLButtonElement;
// Two mutually-exclusive ways to answer the Neighbour round: click the
// neighbours on the map, or search and pick them by name.
export function applyNbMode(): void {
  nbBox.classList.toggle("map-mode", app.nbMode === "map");
  if (app.nbMode === "map") { nbInput.value = ""; renderNbResults(""); }
  if (app.mode === "quiz" && app.quizType === "neighbour" && !app.quizAnswered) {
    quizFeedbackEl.textContent = app.nbMode === "map"
      ? "Click every country that borders it on the map, then Check."
      : "Search and add every country that borders it, then Check.";
  }
}

// --- Locate quizzes (name / flag / capital) AND the "Which country" rounds
//     (peak / city): answer by clicking the map or by searching a country by
//     name. The two are mutually exclusive. ---
const locBox = document.getElementById("loc-box") as HTMLElement;
const locModeEl = document.getElementById("loc-mode") as HTMLElement;
export const locInput = document.getElementById("loc-input") as HTMLInputElement;
const locResults = document.getElementById("loc-results")!;

// Set the locate mode and tick the matching radio.
function setLocMode(mode: "map" | "search"): void {
  app.locMode = mode;
  const radio = document.querySelector<HTMLInputElement>('#loc-mode input[value="' + mode + '"]');
  if (radio) radio.checked = true;
}
// "Which country is X?" — the peak/city country-answer rounds reuse the locate
// box, but with NO mode toggle: the search box and map-clicking are both live at
// once (the feature itself is left unmarked so it can't give the answer away).
function isCountryAnswerQuiz(): boolean {
  return app.quizType === "peakcountry" || app.quizType === "citycountry";
}
function countryAnswerSubject(): string {
  if (app.quizType === "peakcountry") return app.quizPeak ? app.quizPeak.name : "it";
  if (app.quizType === "citycountry") return app.quizCity ? app.quizCity.name : "it";
  return "it";
}
function setupCountryAnswerBox(): void {
  nameBox.hidden = true;
  quizLayer.clearLayers();
  setupLocateBox();
  locModeEl.hidden = true;   // no toggle — search + map-click are both active
  setLocMode("search");      // show the search input (map-clicks route regardless)
  map.setView([20, 0], 2);   // neutral world view
  applyLocMode();
}
export function applyLocMode(): void {
  locBox.classList.toggle("map-mode", app.locMode === "map");
  if (app.locMode === "map") { locInput.value = ""; renderLocResults(""); }
  if (app.mode !== "quiz" || app.quizAnswered) return;
  if (isLocateQuiz()) {
    quizFeedbackEl.textContent = app.locMode === "map" ? "Click it on the map." : "Find and select the country.";
  } else if (isCountryAnswerQuiz()) {
    // Both answer paths are open at once, so the hint mentions both.
    quizFeedbackEl.textContent = "In which country is " + countryAnswerSubject() + "? Select it, or click it on the map.";
  }
}
function isLocateQuiz(): boolean {
  return app.quizType === "name" || app.quizType === "flag" || app.quizType === "capital";
}
export function renderLocResults(query: string): void {
  const q = query.trim().toLowerCase();
  locResults.innerHTML = "";
  if (!q) return;
  realCountries()
    .filter((c) => c.name.toLowerCase().indexOf(q) !== -1)
    .slice(0, 8)
    .forEach((c) => {
      const li = document.createElement("li");
      const flag = c.iso2 ? '<img src="https://flagcdn.com/20x15/' + c.iso2 + '.png" alt="">' : "";
      li.innerHTML = flag + "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => {
        if (app.quizAnswered) return;
        locInput.value = ""; locResults.innerHTML = "";
        // Route to the right handler: peak/city "Which country" vs plain locate.
        if (app.quizType === "peakcountry") handlePeakCountryGuess(c);
        else if (app.quizType === "citycountry") handleCityCountryGuess(c);
        else handleGuess(c);
      });
      locResults.appendChild(li);
    });
}

// --- "Name it" rounds (peak / city): the feature is marked on the map; search
//     its name and pick it. (No map-click answer — that was the rejected
//     click-the-dot approach.) ---
const nameBox = document.getElementById("name-box") as HTMLElement;
export const nameInput = document.getElementById("name-input") as HTMLInputElement;
const nameResults = document.getElementById("name-results")!;
// Reset + show the feature-name search box (hides the other answer widgets).
function setupNameBox(): void {
  quizChoicesEl.hidden = true;
  nbBox.hidden = true; locBox.hidden = true;
  quizContLayer.clearLayers();
  nameInput.value = ""; nameInput.disabled = false;
  nameResults.innerHTML = "";
  nameBox.hidden = false;
}
export function renderNameResults(query: string): void {
  const q = query.trim().toLowerCase();
  nameResults.innerHTML = "";
  if (!q) return;
  if (app.quizType === "peakname") {
    PEAKS.filter((p) => p.name.toLowerCase().indexOf(q) !== -1).slice(0, 8).forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = "<span>" + escapeHtml(p.name) + "</span>";
      li.addEventListener("click", () => { if (!app.quizAnswered) { nameInput.value = ""; nameResults.innerHTML = ""; handlePeakNameGuess(p.name); } });
      nameResults.appendChild(li);
    });
  } else if (app.quizType === "cityname") {
    cityQuizPool().filter((c) => c.name.toLowerCase().indexOf(q) !== -1).slice(0, 8).forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => { if (!app.quizAnswered) { nameInput.value = ""; nameResults.innerHTML = ""; handleCityNameGuess(c.name); } });
      nameResults.appendChild(li);
    });
  } else if (app.quizType === "rivername" || app.quizType === "lakename") {
    const pool = app.quizType === "rivername" ? riverQuizPool() : lakeQuizPool();
    pool.filter((it) => it.name.toLowerCase().indexOf(q) !== -1).slice(0, 8).forEach((it) => {
      const li = document.createElement("li");
      li.innerHTML = "<span>" + escapeHtml(it.name) + "</span>";
      li.addEventListener("click", () => { if (!app.quizAnswered) { nameInput.value = ""; nameResults.innerHTML = ""; handleWaterNameGuess(it.name); } });
      nameResults.appendChild(li);
    });
  }
}

export function renderNbResults(query: string): void {
  const q = query.trim().toLowerCase();
  nbResults.innerHTML = "";
  if (!q || !app.quizTarget) return;
  realCountries()
    .filter((c) => c !== app.quizTarget && !app.nbSelected.has(c) && c.name.toLowerCase().indexOf(q) !== -1)
    .slice(0, 8)
    .forEach((c) => {
      const li = document.createElement("li");
      const flag = c.iso2 ? '<img src="https://flagcdn.com/20x15/' + c.iso2 + '.png" alt="">' : "";
      li.innerHTML = flag + "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => addNbPick(c));
      nbResults.appendChild(li);
    });
}
function renderNbChips(): void {
  nbChips.innerHTML = "";
  app.nbSelected.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = c.name + " ";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.title = "Remove";
    x.addEventListener("click", () => { app.nbSelected.delete(c); renderNbChips(); refreshPolygons(); });
    chip.appendChild(x);
    nbChips.appendChild(chip);
  });
}
function addNbPick(c: CountryEntry): void {
  if (app.quizAnswered) return;
  app.nbSelected.add(c);
  nbInput.value = "";
  renderNbResults("");
  renderNbChips();
  refreshPolygons();
}
export function toggleNbPick(c: CountryEntry): void {
  if (app.quizAnswered) return;
  if (app.nbSelected.has(c)) app.nbSelected.delete(c); else app.nbSelected.add(c);
  renderNbChips();
  refreshPolygons();
}
export function nbCheckAnswers(): void {
  if (app.mode !== "quiz" || app.quizType !== "neighbour" || !app.quizTarget || app.quizAnswered) return;
  app.quizAnswered = true;
  app.quizTotal++;
  const missed = Array.from(app.quizNeighbourSet).filter((n) => !app.nbSelected.has(n));
  const wrong = Array.from(app.nbSelected).filter((p) => !app.quizNeighbourSet.has(p));
  const ok = missed.length === 0 && wrong.length === 0;
  if (ok) app.quizCorrect++;
  const total = app.quizNeighbourSet.size;
  let msg = (ok ? "✓ " : "✗ ") + "Found " + (total - missed.length) + " of " + total +
    " neighbours of " + app.quizTarget.name + ".";
  if (wrong.length) msg += " Wrong: " + wrong.map((w) => w.name).join(", ") + ".";
  if (missed.length) msg += " Missed: " + missed.map((m) => m.name).join(", ") + ".";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = msg;
  renderQuizScore();
  nbInput.disabled = true;
  nbCheck.disabled = true;
  quizNextBtn.disabled = false;
  refreshPolygons();
  // Reveal on the map: anchor (blue), all neighbours (green), wrong picks (red).
  quizLayer.clearLayers();
  const tc = layerCenter(app.quizTarget);
  if (tc) addQuizDot(app.quizTarget, tc, "target");
  app.quizNeighbourSet.forEach((n) => { const c = layerCenter(n); if (c) addQuizDot(n, c, "correct"); });
  wrong.forEach((w) => { const c = layerCenter(w); if (c) addQuizDot(w, c, "wrong"); });
  try {
    let b = app.quizTarget.layer.getBounds();
    app.quizNeighbourSet.forEach((n) => { try { b = b.extend(n.layer.getBounds()); } catch { /* ignore */ } });
    map.fitBounds(b, { maxZoom: 6, padding: [50, 50] });
  } catch { /* ignore */ }
}

export function handleGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || !app.quizTarget || app.quizAnswered || entry.isLandmass) return;
  app.quizGuess = entry;
  app.quizAnswered = true;
  app.quizTotal++;
  const ok = entry === app.quizTarget;
  quizLayer.clearLayers();
  const tCenter = layerCenter(app.quizTarget);
  if (ok) {
    app.quizCorrect++;
    quizFeedbackEl.className = "correct";
    quizFeedbackEl.textContent = "✓ Correct! It's " + app.quizTarget.name + ".";
    if (tCenter) addQuizDot(app.quizTarget, tCenter, "correct"); // labelled green dot
  } else {
    quizFeedbackEl.className = "wrong";
    quizFeedbackEl.innerHTML = "✗ That's " + escapeHtml(entry.name) +
      '. <a href="#" class="quiz-zoom">' + escapeHtml(app.quizTarget.name) + "</a> is the right one.";
    const z = quizFeedbackEl.querySelector(".quiz-zoom");
    if (z) z.addEventListener("click", (ev) => { ev.preventDefault(); zoomToTarget(8); });
    // Draw a line from the guess to the correct country (both labelled) so the
    // location is clear even for a tiny island. (No auto-zoom — use the link.)
    const gCenter = layerCenter(entry);
    if (gCenter && tCenter) {
      L.polyline([gCenter, tCenter], { color: "#8a3b00", weight: 2, opacity: 0.85, dashArray: "5 5" }).addTo(quizLayer);
      addQuizDot(app.quizTarget, tCenter, "correct");  // green: the right answer
      addQuizDot(entry, gCenter, "wrong");         // red: your guess
    }
  }
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true;
  locResults.innerHTML = "";
  refreshPolygons();
}

type DotKind = "correct" | "wrong" | "target";
const DOT_COLORS: Record<DotKind, { stroke: string; fill: string }> = {
  correct: { stroke: "#1b7a3d", fill: "#54c47e" },
  wrong: { stroke: "#9c1b12", fill: "#e8675c" },
  target: { stroke: "#1b3a5c", fill: "#3878c7" },
};
function addQuizDot(entry: CountryEntry, latlng: LatLng, kind: DotKind): void {
  // Always show flag + name on the dots once a guess is made.
  const flag = entry.iso2
    ? '<img class="quiz-dot-flag" src="https://flagcdn.com/24x18/' + entry.iso2 + '.png" alt=""> '
    : "";
  const col = DOT_COLORS[kind];
  // The answer is already revealed, so link the name to Wikipedia (interactive
  // tooltip) — handy for reading up on a country you just learned.
  const nameLink = '<a href="' + wikiUrl(entry.name) + '" target="_blank" rel="noopener">' +
    escapeHtml(entry.name) + "</a>";
  L.circleMarker(latlng, {
    radius: kind === "wrong" ? 5 : 6, color: col.stroke, weight: 2, fillColor: col.fill, fillOpacity: 1,
  }).bindTooltip(flag + nameLink, {
    permanent: true, direction: "top", interactive: true, className: "map-label quiz-label quiz-label-" + kind,
  }).addTo(quizLayer);
}

function zoomToTarget(maxZoom: number): void {
  if (!app.quizTarget) return;
  try { map.fitBounds(app.quizTarget.layer.getBounds(), { maxZoom, padding: [50, 50] }); } catch { /* ignore */ }
}
export function setMode(m: "explore" | "quiz"): void {
  app.mode = m;
  document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => { b.classList.toggle("active", b.dataset.mode === m); });
  (document.getElementById("explore-panel") as HTMLElement).hidden = m !== "explore";
  (document.getElementById("quiz-panel") as HTMLElement).hidden = m !== "quiz";
  hideHoverInfo();
  if (m === "explore") {
    quizLayer.clearLayers();
    quizContLayer.clearLayers();
  } else {
    app.selectedLayer = null; app.selectedContinent = null; app.expandedContinent = null;
    if (!app.quizStarted) { app.quizStarted = true; app.quizCorrect = 0; app.quizTotal = 0; }
    // Resume the open section's quiz, or open Countries the first time round.
    const open = currentQuizSection();
    if (open) setQuizCat(SECTION_CAT[open]); else openQuizSection("countries");
    renderQuizScore();
  }
  hooks.refreshAll();
}

// ---------------------------------------------------------------------------
// Quiz sections (accordion): one collapsible section per feature, mirroring the
// Explore list. Opening a section starts that quiz and relocates the shared
// question UI (#quiz-ui) into its body. Countries/Mountains carry their own mode
// rows (#quiz-type / #mtn-type); Regions is the continent round (no sub-modes).
// ---------------------------------------------------------------------------
const QUIZ_SECTIONS = ["countries", "cities", "regions", "lakes", "mountains", "rivers"];
const SECTION_CAT: Record<string, "country" | "city" | "continent" | "mountains" | "lake" | "river"> = {
  countries: "country", cities: "city", regions: "continent", mountains: "mountains", lakes: "lake", rivers: "river",
};
const quizUiEl = document.getElementById("quiz-ui") as HTMLElement;

function currentQuizSection(): string | null {
  return QUIZ_SECTIONS.find((s) => {
    const el = document.getElementById("quiz-sec-" + s);
    return !!el && !el.classList.contains("collapsed");
  }) || null;
}

export function openQuizSection(id: string): void {
  const sec = document.getElementById("quiz-sec-" + id);
  if (!sec || sec.classList.contains("disabled")) return;
  // Clicking the already-open section collapses it (quiz paused, reveals cleared).
  if (!sec.classList.contains("collapsed")) {
    sec.classList.add("collapsed");
    quizLayer.clearLayers();
    quizContLayer.clearLayers();
    return;
  }
  // Accordion: only one section open at a time.
  QUIZ_SECTIONS.forEach((s) => document.getElementById("quiz-sec-" + s)?.classList.add("collapsed"));
  sec.classList.remove("collapsed");
  sec.querySelector(".quiz-sec-body")!.appendChild(quizUiEl); // move shared UI in
  setQuizCat(SECTION_CAT[id]);
}

// Set the active quiz type for a section's category, then ask the first question.
// "country"/"mountains" read the active button in their mode row; "continent"
// (Regions) has a single round.
function setQuizCat(cat: "country" | "city" | "continent" | "mountains" | "lake" | "river"): void {
  if (cat === "continent") {
    app.quizType = "continent";
  } else if (cat === "lake") {
    app.quizType = "lakename";
  } else if (cat === "river") {
    app.quizType = "rivername";
  } else if (cat === "city") {
    const active = document.querySelector<HTMLElement>("#city-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "cityname";
  } else if (cat === "mountains") {
    const active = document.querySelector<HTMLElement>("#mtn-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "peakname";
  } else {
    const active = document.querySelector<HTMLElement>("#quiz-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "name";
  }
  if (app.mode === "quiz") nextQuestion();
}
