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
import { refreshPolygons, countryAt } from "./countries";

const quizPromptEl = document.getElementById("quiz-prompt")!;
const quizFeedbackEl = document.getElementById("quiz-feedback")!;
const quizScoreEl = document.getElementById("quiz-score")!;
const quizChoicesEl = document.getElementById("quiz-choices")!;
export const quizNextBtn = document.getElementById("quiz-next") as HTMLButtonElement;
export const quizSkipBtn = document.getElementById("quiz-skip") as HTMLButtonElement;
export const quizResetBtn = document.getElementById("quiz-reset") as HTMLButtonElement;

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
  if (app.quizType === "rivercountry" || app.quizType === "lakecountry") {
    // "Which country": name the river/lake (the country is the answer).
    const tag = app.quizType === "rivercountry" ? "river" : "lake";
    quizPromptEl.innerHTML = '<span class="quiz-cap-tag">' + tag + '</span> <span>' + escapeHtml(quizWaterTarget ? quizWaterTarget.name : "") + "</span>";
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
// Score is kept per category (the six sections). quizCorrect/quizTotal are the
// ACTIVE category's live counters; switching section saves them into quizScores
// and loads the new category's. Switching mode within a section keeps counting.
type ScoreCat = "country" | "city" | "continent" | "mountains" | "lake" | "river";
const CAT_LABEL: Record<ScoreCat, string> = {
  country: "Countries", city: "Cities", continent: "Regions", mountains: "Mountains", lake: "Lakes", river: "Rivers",
};
const quizScores: Record<string, { correct: number; total: number }> = {};
let scoreCat: ScoreCat = "country";
function setScoreCategory(cat: ScoreCat): void {
  if (cat === scoreCat) return; // same section — keep the running counters
  quizScores[scoreCat] = { correct: app.quizCorrect, total: app.quizTotal };
  scoreCat = cat;
  const s = quizScores[cat] || { correct: 0, total: 0 };
  app.quizCorrect = s.correct; app.quizTotal = s.total;
  renderQuizScore(); // the active category changed — refresh the readout
}
export function resetScores(): void {
  for (const k of Object.keys(quizScores)) delete quizScores[k];
  app.quizCorrect = 0; app.quizTotal = 0;
  renderQuizScore();
}
function renderQuizScore(): void {
  quizScoreEl.textContent = app.quizTotal ? CAT_LABEL[scoreCat] + ": " + app.quizCorrect + " / " + app.quizTotal : "";
  saveScores();
}
// Persist scores across reloads (localStorage). The active category's running
// counters live in quizCorrect/quizTotal, so merge them into the saved map.
const SCORES_KEY = "atlasaurus.scores";
function saveScores(): void {
  const all = { ...quizScores, [scoreCat]: { correct: app.quizCorrect, total: app.quizTotal } };
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
}
function restoreScores(): void {
  let saved: Record<string, { correct: number; total: number }> = {};
  try { saved = JSON.parse(localStorage.getItem(SCORES_KEY) || "{}"); } catch { return; }
  for (const k of Object.keys(saved)) {
    const s = saved[k];
    if (s && typeof s.total === "number" && typeof s.correct === "number") quizScores[k] = { correct: s.correct, total: s.total };
  }
  const cur = quizScores[scoreCat]; // seed the active category's live counters
  if (cur) { app.quizCorrect = cur.correct; app.quizTotal = cur.total; }
}
restoreScores();
// Neighbouring countries (mledoze `borders`, resolved to entries we have).
function neighbourEntries(entry: CountryEntry): CountryEntry[] {
  const codes = (app.countryData && entry.iso && app.countryData[entry.iso] && app.countryData[entry.iso].borders) || [];
  return codes.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
}

// Pick a random pool member while avoiding the recently-asked ones (up to half
// the pool), so questions don't repeat soon after each other. History is kept
// per key (country / peak / city / river / lake). Callers guard pool.length > 0.
const recentByKey: Record<string, unknown[]> = {};
function pickNext<T>(key: string, pool: T[]): T {
  const hist = recentByKey[key] || (recentByKey[key] = []);
  const cap = Math.max(1, Math.floor(pool.length / 2));
  const recent = new Set(hist.slice(-cap));
  let pick = pool[Math.floor(Math.random() * pool.length)];
  for (let i = 0; i < 40 && recent.has(pick); i++) pick = pool[Math.floor(Math.random() * pool.length)];
  hist.push(pick);
  if (hist.length > cap) hist.splice(0, hist.length - cap);
  return pick;
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
  if (isWaterQuiz()) { nextWaterQuestion(); return; }
  // Restrict the pool to countries that have what the prompt needs.
  const pool = app.quizType === "flag" ? realCountries().filter((c) => c.iso2)
    : app.quizType === "capital" ? realCountries().filter((c) => c.capitalName)
    : app.quizType === "neighbour" ? realCountries().filter((c) => neighbourEntries(c).length > 0)
    : realCountries();
  if (!pool.length) return;
  const t = pickNext("country", pool);
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
    app.nbMode = "search"; // no toggle — clicking the map and searching both add picks
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
    app.locMode = "search";      // always answered by typing the name (map-click excluded for Spot)
    applyLocMode();
    const c = app.quizTarget ? layerCenter(app.quizTarget) : null;
    map.setView([20, 0], 2);
    if (c) L.circleMarker(c, { radius: 9, color: "#8a3b00", weight: 3, fillColor: "#e8740c", fillOpacity: 0.9 }).addTo(quizLayer);
    quizFeedbackEl.textContent = "Which country is highlighted? Type its name.";
  } else {
    setupLocateBox();
    // No mode toggle — map-clicking always answers. The search box shows too,
    // except for By name (where the name is given, so searching is trivial).
    setLocMode(app.quizType === "name" ? "map" : "search");
    applyLocMode();
  }
  quizNextBtn.disabled = true;
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Mountain-peak quiz (Name it / Which country)
// ---------------------------------------------------------------------------
// Add the peak marker (orange) to quizLayer; the caller clears the layer first.
function drawQuizPeak(withLabel: boolean): void {
  if (!app.quizPeak) return;
  const m = L.marker([app.quizPeak.lat, app.quizPeak.lng], { icon: peakIcon(map.getZoom(), true), keyboard: false });
  if (withLabel) {
    m.bindTooltip(nameLink(app.quizPeak.name, wikiUrl(app.quizPeak.wiki || app.quizPeak.name)),
      { permanent: true, direction: "top", interactive: true, className: "map-label" });
  }
  m.addTo(quizLayer);
}
function nextPeakQuestion(): void {
  const pool = app.quizType === "peakcountry" ? PEAKS.filter((p) => p.iso.length) : PEAKS;
  if (!pool.length) return;
  app.quizPeak = pickNext("peak", pool);
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
    quizLayer.clearLayers();
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
  const target = app.quizPeak;
  const ok = name === target.name;
  if (ok) app.quizCorrect++;
  nameInput.disabled = true; nameResults.innerHTML = "";
  const facts = " — " + fmtInt(target.elevation) + " m, " + peakCountryNames(target) + ".";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok ? "✓ Correct! " + target.name + facts : "You selected " + name + ", the correct answer is " + target.name + facts;
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Green dot on the right peak; red dot on the one you picked + a line between.
  quizLayer.clearLayers();
  const tll: LatLng = [target.lat, target.lng];
  markDot(tll, nameLink(target.name, wikiUrl(target.wiki || target.name)), "correct");
  const wrong = ok ? null : PEAKS.find((p) => p.name === name);
  if (wrong) {
    const wll: LatLng = [wrong.lat, wrong.lng];
    markDot(wll, nameLink(wrong.name, wikiUrl(wrong.wiki || wrong.name)), "wrong");
    connectDots(wll, tll);
  }
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
    : "You selected " + entry.name + ", the correct answer is " + names + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true; locResults.innerHTML = "";
  // Reveal: the peak (orange) + green dot(s) on its country(ies), red on the wrong pick + line.
  quizLayer.clearLayers();
  drawQuizPeak(true);
  const correct = app.quizPeak.iso.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
  revealCountryDots(correct, ok ? null : entry);
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Cities quiz (mirrors the mountain-peak rounds): "Name it" marks the city and
// you search its name; "Which country" names the city (no marker) and you click
// or search its country. Pool comes from places.ts.
// ---------------------------------------------------------------------------
// Add the city marker (orange) to quizLayer; the caller clears the layer first.
function drawQuizCity(withLabel: boolean): void {
  const c = app.quizCity;
  if (!c) return;
  const m = L.circleMarker([c.lat, c.lng], { radius: 7, color: "#8a3b00", weight: 3, fillColor: "#e8740c", fillOpacity: 0.9 });
  if (withLabel) {
    m.bindTooltip(nameLink(c.name, cityWikiUrl(c.name)),
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
  const c = pickNext("city", pool);
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
    quizLayer.clearLayers();
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
  const target = app.quizCity;
  const ok = name === target.name;
  if (ok) app.quizCorrect++;
  nameInput.disabled = true; nameResults.innerHTML = "";
  const where = target.adm0 ? ", " + target.adm0 : "";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok ? "✓ Correct! " + target.name + where + "." : "You selected " + name + ", the correct answer is " + target.name + where + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Green dot on the right city; red dot on the one you picked + a line between.
  quizLayer.clearLayers();
  const tll: LatLng = [target.lat, target.lng];
  markDot(tll, nameLink(target.name, cityWikiUrl(target.name)), "correct");
  const wrong = ok ? null : cityQuizPool().find((c) => c.name === name);
  if (wrong) {
    const wll: LatLng = [wrong.lat, wrong.lng];
    markDot(wll, nameLink(wrong.name, cityWikiUrl(wrong.name)), "wrong");
    connectDots(wll, tll);
  }
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
    : "You selected " + entry.name + ", the correct answer is " + countryName + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true; locResults.innerHTML = "";
  // Reveal: the city (orange) + green dot on its country, red on the wrong pick + line.
  quizLayer.clearLayers();
  drawQuizCity(true);
  revealCountryDots(where ? [where] : [], ok ? null : entry);
  refreshPolygons();
}

// ---------------------------------------------------------------------------
// Rivers / Lakes quiz ("Name it" only — no country data, often multi-country):
// the feature's geometry is highlighted on the map (no label); search its name.
// ---------------------------------------------------------------------------
let quizWaterTarget: WaterQuizItem | null = null;
let quizWaterCountries: CountryEntry[] = []; // "which country": the countries the target touches
function isWaterQuiz(): boolean {
  return app.quizType === "rivername" || app.quizType === "lakename"
    || app.quizType === "rivercountry" || app.quizType === "lakecountry";
}
function isLakeShape(): boolean { return app.quizType === "lakename" || app.quizType === "lakecountry"; }
const WATER_COLORS: Record<DotKind, { stroke: string; fill: string }> = {
  target: { stroke: "#8a3b00", fill: "#e8740c" },  // the feature in question (orange)
  correct: { stroke: "#1b7a3d", fill: "#54c47e" }, // matches DOT_COLORS.correct (green)
  wrong: { stroke: "#9c1b12", fill: "#e8675c" },   // matches DOT_COLORS.wrong (red)
};
// Draw a water feature's geometry (lake polygon / river line) into quizLayer in
// the given colour; the caller clears the layer first.
function drawWater(item: WaterQuizItem, kind: DotKind, withLabel: boolean): void {
  const isLake = isLakeShape();
  const col = WATER_COLORS[kind];
  item.layers.forEach((layer) => {
    const ll = (layer as any).getLatLngs();
    (isLake
      ? L.polygon(ll, { color: col.stroke, weight: 2, fillColor: col.fill, fillOpacity: 0.5 })
      : L.polyline(ll, { color: col.fill, weight: 4, opacity: 0.95 })).addTo(quizLayer);
  });
  if (withLabel) {
    L.tooltip({ permanent: true, direction: "top", interactive: true, className: "map-label quiz-label quiz-label-" + kind })
      .setLatLng(item.bounds.getCenter()).setContent(nameLink(item.name, wikiUrl(item.name))).addTo(quizLayer);
  }
}
// Sample points along a water feature and resolve which countries it passes
// through (point-in-polygon against the country layers).
function waterCountries(item: WaterQuizItem): CountryEntry[] {
  const seen = new Set<string>();
  const out: CountryEntry[] = [];
  const consider = (lat: number, lng: number) => {
    const e = countryAt(lat, lng);
    if (e && e.iso && !seen.has(e.iso)) { seen.add(e.iso); out.push(e); }
  };
  item.layers.forEach((layer) => {
    const flat: L.LatLng[] = [];
    const collect = (a: any) => { if (a && typeof a.lat === "number") flat.push(a); else if (Array.isArray(a)) a.forEach(collect); };
    collect((layer as any).getLatLngs());
    const step = Math.max(1, Math.floor(flat.length / 10));
    for (let i = 0; i < flat.length; i += step) consider(flat[i].lat, flat[i].lng);
  });
  const c = item.bounds.getCenter();
  consider(c.lat, c.lng);
  return out;
}
function nextWaterQuestion(): void {
  const isCountry = app.quizType === "rivercountry" || app.quizType === "lakecountry";
  const isRiver = app.quizType === "rivername" || app.quizType === "rivercountry";

  // Reset state and show the answer UI immediately, so the panel isn't blank
  // while the river/lake dataset loads.
  quizWaterTarget = null; quizWaterCountries = []; app.quizWaterIso = [];
  app.quizTarget = null; app.quizPeak = null; app.quizCity = null; app.quizGuess = null; app.quizAnswered = false;
  app.quizContCorrect = null; app.quizContWrong = null; app.quizNeighbourSet = new Set();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (isCountry) setupCountryAnswerBox(); else setupNameBox();
  quizNextBtn.disabled = true;

  // Dataset is fetched lazily (usually already preloaded). Until it's ready the
  // answer UI shows a "Loading…" hint; once ready we pick a target and draw it.
  if (!(isRiver ? riversReady() : lakesReady())) {
    quizFeedbackEl.textContent = "Loading…";
    (isRiver ? loadRiverData() : loadLakeData())
      .then(() => { if (app.mode === "quiz" && isWaterQuiz()) nextWaterQuestion(); })
      .catch(() => { /* ignore */ });
    return;
  }

  const pool = isRiver ? riverQuizPool() : lakeQuizPool();
  if (!pool.length) return;
  // Pick a fresh target; for "which country" require one that resolves to ≥1 country.
  const key = isRiver ? "river" : "lake";
  let item: WaterQuizItem | null = null;
  let countries: CountryEntry[] = [];
  for (let i = 0; i < 25; i++) {
    const cand = pickNext(key, pool);
    if (!isCountry) { item = cand; break; }
    const cs = waterCountries(cand);
    if (cs.length) { item = cand; countries = cs; break; }
  }
  if (!item) return;
  quizWaterTarget = item;
  quizWaterCountries = countries;
  app.quizWaterIso = countries.map((c) => c.iso || "").filter(Boolean);
  renderQuizPrompt(); // which-country prompt now shows the resolved name
  if (isCountry) {
    applyLocMode();   // refresh the "In which country is <name>?" hint
  } else {
    quizFeedbackEl.className = "";
    quizFeedbackEl.textContent = isRiver ? "Which river is highlighted? Search and pick it." : "Which lake is highlighted? Search and pick it.";
    quizLayer.clearLayers();
    drawWater(item, "target", false);
    try { map.fitBounds(item.bounds, { maxZoom: 7, padding: [40, 40] }); } catch { /* ignore */ }
  }
  refreshPolygons();
}
function handleWaterNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !quizWaterTarget) return;
  app.quizAnswered = true; app.quizTotal++;
  const target = quizWaterTarget;
  const ok = name === target.name;
  if (ok) app.quizCorrect++;
  nameInput.disabled = true; nameResults.innerHTML = "";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok ? "✓ Correct! " + target.name + "." : "You selected " + name + ", the correct answer is " + target.name + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Right feature green, the one you picked red, with a line between.
  quizLayer.clearLayers();
  drawWater(target, "correct", true);
  const pool = app.quizType === "rivername" ? riverQuizPool() : lakeQuizPool();
  const wrong = ok ? null : pool.find((it) => it.name === name);
  if (wrong) {
    drawWater(wrong, "wrong", true);
    const w = wrong.bounds.getCenter(), t = target.bounds.getCenter();
    connectDots([w.lat, w.lng], [t.lat, t.lng]);
  }
}
export function handleWaterCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || !(app.quizType === "rivercountry" || app.quizType === "lakecountry") || app.quizAnswered || !quizWaterTarget || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true; app.quizTotal++;
  const ok = quizWaterCountries.some((c) => c === entry || (!!c.iso && c.iso === entry.iso));
  if (ok) app.quizCorrect++;
  const names = quizWaterCountries.map((c) => c.name).join(", ") || "—";
  const verb = app.quizType === "rivercountry" ? "runs through" : "lies in";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "✓ Correct! " + quizWaterTarget.name + " " + verb + " " + names + "."
    : "You selected " + entry.name + ", the correct answer is " + names + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  locInput.disabled = true; locResults.innerHTML = "";
  // Reveal: the water feature (orange) + green dot(s) on its country(ies), red on the wrong pick + line.
  quizLayer.clearLayers();
  drawWater(quizWaterTarget, "target", true);
  revealCountryDots(quizWaterCountries, ok ? null : entry);
  refreshPolygons();
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
    : "You selected " + name + ", the correct answer is " + correct + ".";
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
// Neighbour round: clicking the map and searching both add picks (no toggle).
export function applyNbMode(): void {
  nbBox.classList.toggle("map-mode", app.nbMode === "map");
  if (app.nbMode === "map") { nbInput.value = ""; renderNbResults(""); }
  if (app.mode === "quiz" && app.quizType === "neighbour" && !app.quizAnswered) {
    quizFeedbackEl.textContent = "Click every bordering country on the map, or search to add them, then Check.";
  }
}

// --- Locate quizzes (name / flag / capital) AND the "Which country" rounds
//     (peak / city): answer by clicking the map or by searching a country by
//     name. The two are mutually exclusive. ---
const locBox = document.getElementById("loc-box") as HTMLElement;
export const locInput = document.getElementById("loc-input") as HTMLInputElement;
const locResults = document.getElementById("loc-results")!;

// "search" shows the country search box; "map" hides it (By name only). Map
// clicks answer regardless — there is no longer a mode toggle.
function setLocMode(mode: "map" | "search"): void { app.locMode = mode; }
// "Which country is X?" — the peak/city country-answer rounds reuse the locate
// box, but with NO mode toggle: the search box and map-clicking are both live at
// once (the feature itself is left unmarked so it can't give the answer away).
function isCountryAnswerQuiz(): boolean {
  return app.quizType === "peakcountry" || app.quizType === "citycountry"
    || app.quizType === "rivercountry" || app.quizType === "lakecountry";
}
function countryAnswerSubject(): string {
  if (app.quizType === "peakcountry") return app.quizPeak ? app.quizPeak.name : "it";
  if (app.quizType === "citycountry") return app.quizCity ? app.quizCity.name : "it";
  if (app.quizType === "rivercountry" || app.quizType === "lakecountry") return quizWaterTarget ? quizWaterTarget.name : "it";
  return "it";
}
function setupCountryAnswerBox(): void {
  nameBox.hidden = true;
  quizLayer.clearLayers();
  setupLocateBox();
  setLocMode("search");      // show the search input (map-clicks route regardless)
  map.setView([20, 0], 2);   // neutral world view
  applyLocMode();
}
export function applyLocMode(): void {
  locBox.classList.toggle("map-mode", app.locMode === "map");
  if (app.locMode === "map") { locInput.value = ""; renderLocResults(""); }
  if (app.mode !== "quiz" || app.quizAnswered) return;
  if (isLocateQuiz()) {
    quizFeedbackEl.textContent = app.quizType === "name"
      ? "Click it on the map."
      : "Click it on the map, or search and select it.";
  } else if (isCountryAnswerQuiz()) {
    // Both answer paths are open at once, so the hint mentions both.
    quizFeedbackEl.textContent = "In which country is " + countryAnswerSubject() + "? Select it, or click it on the map.";
  }
}
function isLocateQuiz(): boolean {
  return app.quizType === "name" || app.quizType === "flag" || app.quizType === "capital";
}
// Rank search matches so names that START with the query come before ones that
// merely contain it, then alphabetically — typing "a" lists Afghanistan… first,
// not Indonesia (which only contains an "a") in arbitrary load order.
function byQueryRank(q: string) {
  return (a: { name: string }, b: { name: string }) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  };
}
export function renderLocResults(query: string): void {
  const q = query.trim().toLowerCase();
  locResults.innerHTML = "";
  if (!q) return;
  realCountries()
    .filter((c) => c.name.toLowerCase().indexOf(q) !== -1)
    .sort(byQueryRank(q))
    .slice(0, 8)
    .forEach((c) => {
      const li = document.createElement("li");
      const flag = c.iso2 ? '<img src="https://flagcdn.com/20x15/' + c.iso2 + '.png" alt="">' : "";
      li.innerHTML = flag + "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => {
        if (app.quizAnswered) return;
        locInput.value = ""; locResults.innerHTML = "";
        // Route to the right handler: peak/city/water "Which country" vs plain locate.
        if (app.quizType === "peakcountry") handlePeakCountryGuess(c);
        else if (app.quizType === "citycountry") handleCityCountryGuess(c);
        else if (app.quizType === "rivercountry" || app.quizType === "lakecountry") handleWaterCountryGuess(c);
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
    PEAKS.filter((p) => p.name.toLowerCase().indexOf(q) !== -1).sort(byQueryRank(q)).slice(0, 8).forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = "<span>" + escapeHtml(p.name) + "</span>";
      li.addEventListener("click", () => { if (!app.quizAnswered) { nameInput.value = ""; nameResults.innerHTML = ""; handlePeakNameGuess(p.name); } });
      nameResults.appendChild(li);
    });
  } else if (app.quizType === "cityname") {
    cityQuizPool().filter((c) => c.name.toLowerCase().indexOf(q) !== -1).sort(byQueryRank(q)).slice(0, 8).forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = "<span>" + escapeHtml(c.name) + "</span>";
      li.addEventListener("click", () => { if (!app.quizAnswered) { nameInput.value = ""; nameResults.innerHTML = ""; handleCityNameGuess(c.name); } });
      nameResults.appendChild(li);
    });
  } else if (app.quizType === "rivername" || app.quizType === "lakename") {
    const pool = app.quizType === "rivername" ? riverQuizPool() : lakeQuizPool();
    pool.filter((it) => it.name.toLowerCase().indexOf(q) !== -1).sort(byQueryRank(q)).slice(0, 8).forEach((it) => {
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
    .sort(byQueryRank(q))
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
  let msg = (ok ? "✓ " : "") + "Found " + (total - missed.length) + " of " + total +
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
  if (ok) {
    app.quizCorrect++;
    quizFeedbackEl.className = "correct";
    quizFeedbackEl.textContent = "✓ Correct! It's " + app.quizTarget.name + ".";
  } else {
    quizFeedbackEl.className = "wrong";
    quizFeedbackEl.innerHTML = "You selected " + escapeHtml(entry.name) +
      ', the correct answer is <a href="#" class="quiz-zoom">' + escapeHtml(app.quizTarget.name) + "</a>.";
    const z = quizFeedbackEl.querySelector(".quiz-zoom");
    if (z) z.addEventListener("click", (ev) => { ev.preventDefault(); zoomToTarget(8); });
  }
  // Green dot on the right country; red dot on the wrong pick + a line between.
  revealCountryDots([app.quizTarget], ok ? null : entry);
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
// A coloured reveal dot with a Wikipedia-linked label (added to quizLayer; the
// caller clears the layer first). Shared by every round's correct/wrong reveal.
function markDot(latlng: LatLng, labelHtml: string, kind: DotKind): void {
  const col = DOT_COLORS[kind];
  L.circleMarker(latlng, {
    radius: kind === "wrong" ? 5 : 6, color: col.stroke, weight: 2, fillColor: col.fill, fillOpacity: 1,
  }).bindTooltip(labelHtml, {
    permanent: true, direction: "top", interactive: true, className: "map-label quiz-label quiz-label-" + kind,
  }).addTo(quizLayer);
}
function connectDots(a: LatLng, b: LatLng): void {
  L.polyline([a, b], { color: "#8a3b00", weight: 2, opacity: 0.85, dashArray: "5 5" }).addTo(quizLayer);
}
function nameLink(name: string, url: string): string {
  return '<a href="' + url + '" target="_blank" rel="noopener">' + escapeHtml(name) + "</a>";
}
function addQuizDot(entry: CountryEntry, latlng: LatLng, kind: DotKind): void {
  // Country dot: flag + name (the answer is revealed, so the name links to Wikipedia).
  const flag = entry.iso2
    ? '<img class="quiz-dot-flag" src="https://flagcdn.com/24x18/' + entry.iso2 + '.png" alt=""> '
    : "";
  markDot(latlng, flag + nameLink(entry.name, wikiUrl(entry.name)), kind);
}
// Shared "country answer" reveal (used by By-name and every "which country"
// round): a green dot on each correct country, a red dot on the wrong pick, and a
// dashed line from the wrong pick to the nearest correct country.
function revealCountryDots(correct: CountryEntry[], wrong: CountryEntry | null): void {
  const wll = wrong ? layerCenter(wrong) : null;
  let nearest: LatLng | null = null, nd = Infinity;
  correct.forEach((c) => {
    const ll = layerCenter(c);
    if (!ll) return;
    addQuizDot(c, ll, "correct");
    if (wll) { const d = (ll[0] - wll[0]) ** 2 + (ll[1] - wll[1]) ** 2; if (d < nd) { nd = d; nearest = ll; } }
  });
  if (wrong && wll && !correct.includes(wrong)) {
    addQuizDot(wrong, wll, "wrong");
    if (nearest) connectDots(wll, nearest);
  }
}

function zoomToTarget(maxZoom: number): void {
  if (!app.quizTarget) return;
  try { map.fitBounds(app.quizTarget.layer.getBounds(), { maxZoom, padding: [50, 50] }); } catch { /* ignore */ }
}
export function setMode(m: "explore" | "practice" | "quiz"): void {
  app.mode = m;
  const inQuiz = m === "practice" || m === "quiz"; // both live under the "Quiz" top tab
  document.querySelectorAll<HTMLElement>(".mode-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === "explore" ? m === "explore" : inQuiz);
  });
  (document.getElementById("explore-panel") as HTMLElement).hidden = m !== "explore";
  (document.getElementById("quiz-panel") as HTMLElement).hidden = !inQuiz;
  (document.getElementById("practice-panel") as HTMLElement).hidden = m !== "practice";
  (document.getElementById("challenge-panel") as HTMLElement).hidden = m !== "quiz";
  if (inQuiz) {
    const sub = m === "quiz" ? "challenge" : "practice";
    const r = document.querySelector<HTMLInputElement>('#quiz-subtabs input[value="' + sub + '"]');
    if (r) r.checked = true;
  }
  hideHoverInfo();
  if (m === "quiz") {
    app.selectedLayer = null; app.selectedContinent = null; app.expandedContinent = null;
    app.quizStarted = true; // per-category scores persist for the session; reset via the button
    // Resume the open section's quiz, or open Countries the first time round.
    const open = currentQuizSection();
    if (open) setQuizCat(SECTION_CAT[open]); else openQuizSection("countries");
    renderQuizScore();
  } else {
    // Explore (browse) and Practice (guess) use the feature layers, not the quiz
    // layers — clear any leftover quiz reveals.
    quizLayer.clearLayers();
    quizContLayer.clearLayers();
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
  setScoreCategory(cat); // swap the live score counters to this section's
  if (cat === "continent") {
    app.quizType = "continent";
  } else if (cat === "lake") {
    const active = document.querySelector<HTMLElement>("#lake-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "lakename";
  } else if (cat === "river") {
    const active = document.querySelector<HTMLElement>("#river-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "rivername";
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
