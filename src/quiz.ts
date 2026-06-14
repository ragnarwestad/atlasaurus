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
  pointsFor, roundComplete, questionNumber, nearestDistractors,
  QUIZ_FULL_POINTS, QUIZ_HELP_POINTS, QUIZ_ROUND_SIZES,
  type CountryEntry, type QuizType, type NamedPoint,
} from "./state";
import { hideHoverInfo } from "./panel";
import {
  peakIcon, peakCountryNames, riverQuizPool, lakeQuizPool, riversReady, lakesReady,
  loadRiverData, loadLakeData, refreshPeaks, refreshRivers, refreshLakes, type WaterQuizItem,
} from "./physical";
import { cityQuizPool, cityDataReady, loadCityData, refreshCities } from "./places";
import { refreshCountryLabels } from "./labels";
import { CONTINENT_LABEL_POS } from "./regions";
import { refreshPolygons, countryAt } from "./countries";

const quizStartEl = document.getElementById("quiz-start")!;
const quizUiEl = document.getElementById("quiz-ui")!;
const quizStartBestEl = document.getElementById("quiz-start-best")!;
const quizPlayinfoEl = document.getElementById("quiz-playinfo")!;
const quizPlayPhaseEl = document.getElementById("quiz-playphase")!;
const quizPromptEl = document.getElementById("quiz-prompt")!;
const quizFeedbackEl = document.getElementById("quiz-feedback")!;
const quizScoreEl = document.getElementById("quiz-score")!;
const quizChoicesEl = document.getElementById("quiz-choices")!;
const quizSummaryEl = document.getElementById("quiz-summary")!;
const qsScoreEl = quizSummaryEl.querySelector(".qs-score") as HTMLElement;
const qsBestEl = quizSummaryEl.querySelector(".qs-best") as HTMLElement;
export const quizNextBtn = document.getElementById("quiz-next") as HTMLButtonElement;
export const quizAgainBtn = document.getElementById("quiz-again") as HTMLButtonElement;
export const quizNewQuizBtn = document.getElementById("quiz-newquiz") as HTMLButtonElement;
export const quizStartBtn = document.getElementById("quiz-start-btn") as HTMLButtonElement;
export const quizQuitBtn = document.getElementById("quiz-quit") as HTMLButtonElement;
const scoreModalEl = document.getElementById("score-modal")!;
const scoreListEl = document.getElementById("score-list")!;
const scoreFootEl = document.getElementById("score-foot")!;

// Append the full-points reward to a pre-answer instruction, so every round shows
// what a correct answer is worth right in the hint. Only used on the pre-answer
// instructions — the answered/help paths set their own feedback.
function instr(text: string): string { return text + " (" + QUIZ_FULL_POINTS + " pts)"; }
function renderQuizPrompt(): void {
  renderQuizScore(); // keep the "Q n/10 · pts · Best" readout in step with each question
  if (app.quizType === "peakname") {
    quizPromptEl.innerHTML = "<span>Which mountain?</span>";
    return;
  }
  if (app.quizType === "peakcountry") {
    quizPromptEl.innerHTML = "<span>" + escapeHtml(app.quizPeak ? app.quizPeak.name : "") + "</span>";
    return;
  }
  if (app.quizType === "cityname") {
    // "Name it": the city is marked on the map; pick its name (don't reveal it).
    quizPromptEl.innerHTML = "<span>Which city?</span>";
    return;
  }
  if (app.quizType === "citycountry") {
    // "Which country": show the city name; the country is the answer, so hide it.
    quizPromptEl.innerHTML = "<span>" + escapeHtml(app.quizCity ? app.quizCity.name : "") + "</span>";
    return;
  }
  if (app.quizType === "rivername") {
    quizPromptEl.innerHTML = "<span>Which river?</span>";
    return;
  }
  if (app.quizType === "lakename") {
    quizPromptEl.innerHTML = "<span>Which lake?</span>";
    return;
  }
  if (app.quizType === "rivercountry" || app.quizType === "lakecountry") {
    // "Which country": name the river/lake (the country is the answer).
    quizPromptEl.innerHTML = "<span>" + escapeHtml(quizWaterTarget ? quizWaterTarget.name : "") + "</span>";
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
      ? "<span>" + escapeHtml(app.quizTarget.capitalName) + "</span>"
      : "(no capital)";
  } else if (app.quizType === "continent" || app.quizType === "neighbour") {
    // Show the country (flag + name); pick its continent / click a neighbour.
    const flag = app.quizTarget.iso2 ? '<img src="https://flagcdn.com/40x30/' + app.quizTarget.iso2 + '.png" alt="">' : "";
    quizPromptEl.innerHTML = flag + "<span>" + escapeHtml(app.quizTarget.name) + "</span>";
  } else if (app.quizType === "spot") {
    // Spot quiz: the country is highlighted/pinned on the map — naming it is the
    // task, so the prompt must NOT reveal the name.
    quizPromptEl.innerHTML = "<span>Which country?</span>";
  } else {
    // Name quiz: just the name (no flag — that would give it away).
    quizPromptEl.innerHTML = "<span>" + escapeHtml(app.quizTarget.name) + "</span>";
  }
}
// Challenge has three phases: Start (configure category/type/length) → Playing
// (app.roundSize questions) → Finished (summary). quizPoints/quizCorrect/quizTotal
// are the CURRENT round's live counters; only the BEST round per (category, type,
// round size) is persisted — different setups aren't comparable, so kept apart.
export type ScoreCat = "country" | "city" | "continent" | "mountains" | "lake" | "river";
type Best = { points: number; correct: number };
const CAT_LABEL: Record<ScoreCat, string> = {
  country: "Countries", city: "Cities", continent: "Regions", lake: "Lakes", mountains: "Mountains", river: "Rivers",
};
const bestByCat: Record<string, Best> = {};
let scoreCat: ScoreCat = "country";
let roundRecorded = false;   // has this round's result been folded into the best yet
let roundNewBest = false;    // did this round beat the previous best
let roundPrevBest: number | null = null; // the best before this round (for the summary)
// A best belongs to one exact setup: category + question type + round length.
function bestKey(): string { return scoreCat + ":" + app.quizType + ":" + app.roundSize; }
function roundMax(): number { return app.roundSize * QUIZ_FULL_POINTS; }

// Show exactly one phase block (start / playing / finished).
function setPhase(phase: "start" | "playing" | "finished"): void {
  quizStartEl.hidden = phase !== "start";
  quizUiEl.hidden = phase !== "playing";
  quizSummaryEl.hidden = phase !== "finished";
}
// Zero the live counters for a fresh round.
function startRound(): void {
  app.quizPoints = 0; app.quizCorrect = 0; app.quizTotal = 0;
  app.quizAnswered = false; app.quizHelp = false;
  roundRecorded = false; roundNewBest = false; roundPrevBest = null;
}
function setScoreCategory(cat: ScoreCat): void { scoreCat = cat; }

// --- Start phase: pick category/type/length, then Start. ---
// "Best for this setup" line + the (conditional) reset button.
function updateStartBest(): void {
  const best = bestByCat[bestKey()];
  quizStartBestEl.textContent = best ? "Best for this setup: " + best.points + "/" + roundMax() : "No record yet";
}
// Select a category: reflect it on the buttons, swap in its type row (Regions has
// none), set the active type, and refresh the best line.
export function selectCategory(cat: ScoreCat): void {
  setScoreCategory(cat);
  document.querySelectorAll<HTMLElement>("#quiz-cat .cat-btn").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  let activeType: QuizType = "continent";
  document.querySelectorAll<HTMLElement>("#quiz-type-field .type-row").forEach((row) => {
    const show = row.dataset.cat === cat;
    row.hidden = !show;
    if (show) activeType = (row.querySelector<HTMLElement>(".qt-btn.active")?.dataset.qtype as QuizType) || activeType;
  });
  const note = document.querySelector<HTMLElement>("#quiz-type-field .type-none");
  if (note) note.hidden = cat !== "continent";
  app.quizType = cat === "continent" ? "continent" : activeType;
  updateStartBest();
}
// Select a question type within the open category's row.
export function selectType(qtype: QuizType): void {
  app.quizType = qtype;
  updateStartBest();
}
// --- Score overview (the ⋮ → Score modal): every recorded best in one place. ---
const QTYPE_LABEL: Record<string, string> = {
  name: "By name", flag: "By flag", capital: "By capital", spot: "Spot it", neighbour: "Neighbour",
  cityname: "Name it", citycountry: "Which country", peakname: "Name it", peakcountry: "Which country",
  rivername: "Name it", rivercountry: "Which country", lakename: "Name it", lakecountry: "Which country",
  continent: "Regions",
};
const CAT_ORDER: ScoreCat[] = ["country", "city", "continent", "lake", "mountains", "river"];
// Render the grouped list of bests into the modal (and toggle the "Reset all" foot).
function renderScores(): void {
  const keys = Object.keys(bestByCat);
  if (!keys.length) {
    scoreListEl.innerHTML = '<p class="score-empty">No quizzes played yet.</p>';
    scoreFootEl.hidden = true;
    return;
  }
  scoreFootEl.hidden = false;
  // Group keys ("cat:type:size") by category, in the canonical category order.
  const byCat: Record<string, string[]> = {};
  for (const k of keys) (byCat[k.split(":")[0]] = byCat[k.split(":")[0]] || []).push(k);
  scoreListEl.innerHTML = "";
  for (const cat of CAT_ORDER) {
    const group = byCat[cat];
    if (!group || !group.length) continue;
    const h = document.createElement("div");
    h.className = "score-cat";
    h.textContent = CAT_LABEL[cat as ScoreCat];
    scoreListEl.appendChild(h);
    group
      .sort((a, b) => Number(a.split(":")[2]) - Number(b.split(":")[2]))
      .forEach((key) => {
        const [, type, size] = key.split(":");
        const best = bestByCat[key];
        const max = Number(size) * QUIZ_FULL_POINTS;
        const row = document.createElement("div");
        row.className = "score-row";
        const label = cat === "continent" ? size + " questions" : QTYPE_LABEL[type] + " · " + size;
        row.innerHTML = '<span class="sc-label">' + escapeHtml(label) + "</span>"
          + '<span class="sc-pts">' + best.points + "/" + max + "</span>"
          + '<span class="sc-acc">' + best.correct + "/" + size + "</span>";
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "sc-reset"; btn.textContent = "Reset";
        btn.addEventListener("click", () => resetBest(key));
        row.appendChild(btn);
        scoreListEl.appendChild(row);
      });
  }
}
export function openScores(): void {
  renderScores();
  scoreModalEl.hidden = false;
}
export function closeScores(): void { scoreModalEl.hidden = true; }
// Clear one recorded best (Score modal), then re-render and refresh the Start line.
function resetBest(key: string): void {
  delete bestByCat[key];
  saveBest();
  renderScores();
  updateStartBest();
}
export function resetAllScores(): void {
  for (const k of Object.keys(bestByCat)) delete bestByCat[k];
  saveBest();
  renderScores();
  updateStartBest();
}
// Return to the Start screen (also used by Quit and New quiz). Clears reveals.
export function showStart(): void {
  setPhase("start");
  app.quizAnswered = false;
  quizLayer.clearLayers(); quizContLayer.clearLayers();
  revealSurroundings();
  updateStartBest();
  syncRoundSizeButtons();
}
export function quitQuiz(): void { showStart(); }

// --- Playing phase. ---
// Begin a quiz with the chosen setup.
export function startQuiz(): void {
  setPhase("playing");
  quizPlayinfoEl.textContent = playSetupLabel();
  startRound();
  nextQuestion();
}
// "Countries · By flag" — the active category + type, shown in the play header.
function playSetupLabel(): string {
  if (app.quizType === "continent") return CAT_LABEL[scoreCat];
  const row = document.querySelector<HTMLElement>('#quiz-type-field .type-row:not([hidden])');
  const label = row?.querySelector<HTMLElement>(".qt-btn.active")?.textContent || "";
  return CAT_LABEL[scoreCat] + (label ? " · " + label : "");
}
function renderQuizScore(): void {
  const qn = questionNumber(app.quizTotal, app.quizAnswered, app.roundSize);
  quizPlayPhaseEl.textContent = "Playing — Q " + qn + "/" + app.roundSize;
  const best = bestByCat[bestKey()];
  quizScoreEl.textContent = app.quizPoints + " pts" + (best ? " · Best: " + best.points : "");
}
// Tally one answered question into the round counters and return the points won
// (5 normally, 2 if the "show options" help was used, 0 if wrong).
function scoreAnswer(ok: boolean): number {
  app.quizTotal++;
  if (ok) app.quizCorrect++;
  const pts = pointsFor(ok, app.quizHelp);
  app.quizPoints += pts;
  return pts;
}

// --- Finished phase: fold the round into the best (once), then show the summary. ---
function showSummary(): void {
  const key = bestKey();
  if (!roundRecorded) {
    const prev = bestByCat[key];
    roundPrevBest = prev ? prev.points : null;
    roundNewBest = roundPrevBest === null || app.quizPoints > roundPrevBest;
    if (roundNewBest) { bestByCat[key] = { points: app.quizPoints, correct: app.quizCorrect }; saveBest(); }
    roundRecorded = true;
  }
  setPhase("finished");
  qsScoreEl.textContent = app.quizPoints + " / " + roundMax() + " pts · " + app.quizCorrect + " / " + app.roundSize + " correct";
  qsBestEl.textContent = roundNewBest
    ? (roundPrevBest === null ? "★ New best!" : "★ New best! (prev " + roundPrevBest + ")")
    : "Best: " + (bestByCat[key] ? bestByCat[key].points : app.quizPoints);
}
// Same setup, fresh round.
export function playAgain(): void {
  setPhase("playing");
  startRound();
  nextQuestion();
}
function pointsNote(pts: number): string { return " (+" + pts + " pts)"; }
// Retire the help button and, if the 5-option help was showing, colour and lock
// its buttons: every correct option green, the wrong pick (if any) red. Shared by
// the "Name it" and "Which country" rounds (a no-op when no choices are up).
function finishChoices(correctNames: string[], pickedName: string): void {
  quizHelpBtn.hidden = true;
  if (quizChoicesEl.hidden) return;
  const correct = new Set(correctNames);
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const t = btn.textContent || "";
    if (correct.has(t)) btn.classList.add("correct");
    else if (t === pickedName) btn.classList.add("wrong");
  });
}
// Close-out for "Name it": lock the search box, then settle the choice buttons.
function endNameAnswer(correctName: string, pickedName: string): void {
  nameInput.disabled = true; nameResults.innerHTML = "";
  finishChoices([correctName], pickedName);
}
// Close-out for "Which country": lock the country search box, then settle the
// choice buttons (every correct country green, the wrong pick red).
function endCountryAnswer(correct: CountryEntry[], picked: CountryEntry): void {
  locInput.disabled = true; locResults.innerHTML = "";
  finishChoices(correct.map((c) => c.name), picked.name);
}
// Build a 5-option shuffled list: the correct answer plus four sampled from the
// supplied (already nearest-ranked) distractor names.
function buildOptions(correctName: string, distractors: string[]): string[] {
  const picks: string[] = [];
  const bag = distractors.slice();
  while (picks.length < 4 && bag.length) picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  const options = picks.concat(correctName);
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}
// Render choice buttons into #quiz-choices and commit to the reduced reward: the
// search boxes give way to the options, each wired to answer the round.
function renderChoices(options: { label: string; pick: () => void }[]): void {
  app.quizHelp = true;
  nameBox.hidden = true; locBox.hidden = true; quizHelpBtn.hidden = true;
  quizChoicesEl.innerHTML = "";
  options.forEach((o) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = o.label;
    btn.addEventListener("click", () => { if (!app.quizAnswered) o.pick(); });
    quizChoicesEl.appendChild(btn);
  });
  quizChoicesEl.hidden = false;
  quizFeedbackEl.textContent = "Pick the right one (" + QUIZ_HELP_POINTS + " pts)";
}
// Persist the best round per category across reloads (localStorage). The current
// round is ephemeral — a reload starts a new round but the bests survive.
const BEST_KEY = "atlasaurus.best";
function saveBest(): void {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(bestByCat)); } catch { /* storage unavailable */ }
}
function restoreBest(): void {
  let saved: Record<string, Partial<Best>> = {};
  try { saved = JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch { return; }
  for (const k of Object.keys(saved)) {
    const s = saved[k];
    if (s && typeof s.points === "number") bestByCat[k] = { points: s.points, correct: typeof s.correct === "number" ? s.correct : 0 };
  }
}
restoreBest();
// The chosen round length is a single global preference, also persisted.
const ROUNDSIZE_KEY = "atlasaurus.roundsize";
function restoreRoundSize(): void {
  const n = Number(localStorage.getItem(ROUNDSIZE_KEY));
  if (QUIZ_ROUND_SIZES.includes(n)) app.roundSize = n;
}
restoreRoundSize();
// Reflect the active round length on the size buttons (called on load + on change).
function syncRoundSizeButtons(): void {
  document.querySelectorAll<HTMLElement>("#round-size .rs-btn").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.size) === app.roundSize);
  });
}
// Change the round length on the Start screen: persist it and refresh the best
// line (it's locked once a quiz is underway, so no in-round restart needed).
export function setRoundSize(n: number): void {
  if (!QUIZ_ROUND_SIZES.includes(n) || n === app.roundSize) return;
  app.roundSize = n;
  try { localStorage.setItem(ROUNDSIZE_KEY, String(n)); } catch { /* storage unavailable */ }
  syncRoundSizeButtons();
  updateStartBest();
}
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
  // Round over? Show the summary instead of generating another question.
  if (app.mode === "quiz" && roundComplete(app.quizTotal, app.roundSize)) { showSummary(); return; }
  // A fresh question clears the previous answer's reveal: drop the dot bookkeeping
  // and, with quizAnswered now false, re-run the reveal refreshes so they hide the
  // names/features that were shown after the last answer.
  app.quizAnswered = false;
  app.quizHelp = false; // every question starts at full points until help is used
  quizHelpBtn.hidden = true; // shown again only by the rounds that support the help
  app.quizDotCountries.clear();
  app.quizDotCities.clear();
  app.quizDotFeatures.clear();
  revealSurroundings();
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
    quizFeedbackEl.textContent = instr("Click any country in its continent on the map.");
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
    quizFeedbackEl.textContent = instr("Which country is highlighted? Type its name.");
  } else {
    setupLocateBox();
    // No mode toggle — map-clicking always answers. The search box shows too,
    // except for By name (where the name is given, so searching is trivial).
    setLocMode(app.quizType === "name" ? "map" : "search");
    applyLocMode();
  }
  // Flag / capital / spot offer the 5-option help (By name doesn't — name's given).
  quizHelpBtn.hidden = !helpableLocate();
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
    quizFeedbackEl.textContent = instr("Which mountain is marked? Search and pick it.");
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
  app.quizAnswered = true;
  const target = app.quizPeak;
  const ok = name === target.name;
  const pts = scoreAnswer(ok);
  endNameAnswer(target.name, name);
  const facts = " — " + fmtInt(target.elevation) + " m, " + peakCountryNames(target) + ".";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "Correct! " + target.name + facts : "You selected " + name + ", the correct answer is " + target.name + facts) + pointsNote(pts);
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Green dot on the right peak; red dot on the one you picked + a line between.
  quizLayer.clearLayers();
  const tll: LatLng = [target.lat, target.lng];
  app.quizDotFeatures.add(target.name);
  markDot(tll, nameLink(target.name, wikiUrl(target.wiki || target.name)), "correct");
  const wrong = ok ? null : PEAKS.find((p) => p.name === name);
  if (wrong) {
    const wll: LatLng = [wrong.lat, wrong.lng];
    app.quizDotFeatures.add(wrong.name);
    markDot(wll, nameLink(wrong.name, wikiUrl(wrong.wiki || wrong.name)), "wrong");
    connectDots(wll, tll);
  }
  revealSurroundings();
}
export function handlePeakCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || app.quizType !== "peakcountry" || app.quizAnswered || !app.quizPeak || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true;
  const ok = !!entry.iso && app.quizPeak.iso.includes(entry.iso);
  const pts = scoreAnswer(ok);
  const correct = app.quizPeak.iso.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
  endCountryAnswer(correct, entry);
  const names = peakCountryNames(app.quizPeak);
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok
    ? "Correct! " + app.quizPeak.name + " is in " + names + "."
    : "You selected " + entry.name + ", the correct answer is " + names + ".") + pointsNote(pts);
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Reveal: the peak (orange) + green dot(s) on its country(ies), red on the wrong pick + line.
  quizLayer.clearLayers();
  drawQuizPeak(true);
  revealCountryDots(correct, ok ? null : entry);
  refreshPolygons();
  revealSurroundings();
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
    app.quizDotCities.add(c.name); // labelled here, so skip the plain reveal label
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
    quizFeedbackEl.textContent = instr("Which city is marked? Search and pick it.");
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
  app.quizAnswered = true;
  const target = app.quizCity;
  const ok = name === target.name;
  const pts = scoreAnswer(ok);
  endNameAnswer(target.name, name);
  const where = target.adm0 ? ", " + target.adm0 : "";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "Correct! " + target.name + where + "." : "You selected " + name + ", the correct answer is " + target.name + where + ".") + pointsNote(pts);
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Green dot on the right city; red dot on the one you picked + a line between.
  quizLayer.clearLayers();
  const tll: LatLng = [target.lat, target.lng];
  app.quizDotCities.add(target.name);
  markDot(tll, nameLink(target.name, cityWikiUrl(target.name)), "correct");
  const wrong = ok ? null : cityQuizPool().find((c) => c.name === name);
  if (wrong) {
    const wll: LatLng = [wrong.lat, wrong.lng];
    app.quizDotCities.add(wrong.name);
    markDot(wll, nameLink(wrong.name, cityWikiUrl(wrong.name)), "wrong");
    connectDots(wll, tll);
  }
  revealSurroundings();
}
export function handleCityCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || app.quizType !== "citycountry" || app.quizAnswered || !app.quizCity || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true;
  const ok = !!app.quizCity.iso && entry.iso === app.quizCity.iso;
  const pts = scoreAnswer(ok);
  const where = byIso[app.quizCity.iso];
  endCountryAnswer(where ? [where] : [], entry);
  const countryName = (where && where.name) || app.quizCity.adm0 || "another country";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok
    ? "Correct! " + app.quizCity.name + " is in " + countryName + "."
    : "You selected " + entry.name + ", the correct answer is " + countryName + ".") + pointsNote(pts);
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Reveal: the city (orange) + green dot on its country, red on the wrong pick + line.
  quizLayer.clearLayers();
  drawQuizCity(true);
  revealCountryDots(where ? [where] : [], ok ? null : entry);
  refreshPolygons();
  revealSurroundings();
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
    quizFeedbackEl.textContent = instr(isRiver ? "Which river is highlighted? Search and pick it." : "Which lake is highlighted? Search and pick it.");
    quizLayer.clearLayers();
    drawWater(item, "target", false);
    try { map.fitBounds(item.bounds, { maxZoom: 7, padding: [40, 40] }); } catch { /* ignore */ }
  }
  refreshPolygons();
}
function handleWaterNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !quizWaterTarget) return;
  app.quizAnswered = true;
  const target = quizWaterTarget;
  const ok = name === target.name;
  const pts = scoreAnswer(ok);
  endNameAnswer(target.name, name);
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "Correct! " + target.name + "." : "You selected " + name + ", the correct answer is " + target.name + ".") + pointsNote(pts);
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Right feature green, the one you picked red, with a line between.
  quizLayer.clearLayers();
  app.quizDotFeatures.add(target.name);
  drawWater(target, "correct", true);
  const pool = app.quizType === "rivername" ? riverQuizPool() : lakeQuizPool();
  const wrong = ok ? null : pool.find((it) => it.name === name);
  if (wrong) {
    app.quizDotFeatures.add(wrong.name);
    drawWater(wrong, "wrong", true);
    const w = wrong.bounds.getCenter(), t = target.bounds.getCenter();
    connectDots([w.lat, w.lng], [t.lat, t.lng]);
  }
  revealSurroundings();
}
export function handleWaterCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || !(app.quizType === "rivercountry" || app.quizType === "lakecountry") || app.quizAnswered || !quizWaterTarget || entry.isLandmass) return;
  app.quizGuess = entry; app.quizAnswered = true;
  const ok = quizWaterCountries.some((c) => c === entry || (!!c.iso && c.iso === entry.iso));
  const pts = scoreAnswer(ok);
  endCountryAnswer(quizWaterCountries, entry);
  const names = quizWaterCountries.map((c) => c.name).join(", ") || "—";
  const verb = app.quizType === "rivercountry" ? "runs through" : "lies in";
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok
    ? "Correct! " + quizWaterTarget.name + " " + verb + " " + names + "."
    : "You selected " + entry.name + ", the correct answer is " + names + ".") + pointsNote(pts);
  renderQuizScore();
  quizNextBtn.disabled = false;
  // Reveal: the water feature (orange) + green dot(s) on its country(ies), red on the wrong pick + line.
  quizLayer.clearLayers();
  drawWater(quizWaterTarget, "target", true);
  revealCountryDots(quizWaterCountries, ok ? null : entry);
  refreshPolygons();
  revealSurroundings();
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
  const correct = app.quizTarget.continent || "Other";
  const ok = name === correct;
  scoreAnswer(ok);
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const c = btn.dataset.continent;
    if (c === correct) btn.classList.add("correct");
    else if (c === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = ok
    ? "Correct! " + app.quizTarget.name + " is in " + correct + "."
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
  revealSurroundings();
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
    quizFeedbackEl.textContent = instr("Click every bordering country on the map, or search to add them, then Check.");
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
  quizHelpBtn.hidden = false; // "Which country" supports the 5-option help too
  applyLocMode();
}
export function applyLocMode(): void {
  locBox.classList.toggle("map-mode", app.locMode === "map");
  if (app.locMode === "map") { locInput.value = ""; renderLocResults(""); }
  if (app.mode !== "quiz" || app.quizAnswered) return;
  if (isLocateQuiz()) {
    quizFeedbackEl.textContent = instr(app.quizType === "name"
      ? "Click it on the map."
      : "Click it on the map, or search and select it.");
  } else if (isCountryAnswerQuiz()) {
    // Both answer paths are open at once, so the hint mentions both.
    quizFeedbackEl.textContent = instr("In which country is " + countryAnswerSubject() + "? Select it, or click it on the map.");
  }
}
function isLocateQuiz(): boolean {
  return app.quizType === "name" || app.quizType === "flag" || app.quizType === "capital";
}
// The locate rounds that support the 5-option help: flag / capital / spot, where
// the answer is a single country. "By name" is excluded — the name is given, so a
// name-choice list would just hand over the answer.
function helpableLocate(): boolean {
  return app.quizType === "flag" || app.quizType === "capital" || app.quizType === "spot";
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
const quizHelpBtn = document.getElementById("quiz-help") as HTMLButtonElement;
// Reset + show the feature-name search box (hides the other answer widgets).
function setupNameBox(): void {
  quizChoicesEl.hidden = true;
  quizChoicesEl.innerHTML = "";
  nbBox.hidden = true; locBox.hidden = true;
  quizContLayer.clearLayers();
  nameInput.value = ""; nameInput.disabled = false;
  nameResults.innerHTML = "";
  quizHelpBtn.hidden = false; // offer the 5-option help until the round is answered
  nameBox.hidden = false;
}

// --- "Show 5 options" help (Name it only): the user trades full points for a
//     multiple-choice list. The target plus four regionally-near distractors are
//     shown; picking one answers via the same handler with quizHelp set. ---
// The active Name-it round as a uniform {target point, candidate pool, handler}.
function activeNameRound(): { target: NamedPoint; pool: NamedPoint[]; pick: (name: string) => void } | null {
  if (app.quizType === "peakname" && app.quizPeak) {
    return {
      target: { name: app.quizPeak.name, lat: app.quizPeak.lat, lng: app.quizPeak.lng },
      pool: PEAKS.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
      pick: handlePeakNameGuess,
    };
  }
  if (app.quizType === "cityname" && app.quizCity) {
    return {
      target: { name: app.quizCity.name, lat: app.quizCity.lat, lng: app.quizCity.lng },
      pool: cityQuizPool().map((c) => ({ name: c.name, lat: c.lat, lng: c.lng })),
      pick: handleCityNameGuess,
    };
  }
  if ((app.quizType === "rivername" || app.quizType === "lakename") && quizWaterTarget) {
    const pool = app.quizType === "rivername" ? riverQuizPool() : lakeQuizPool();
    const c = quizWaterTarget.bounds.getCenter();
    return {
      target: { name: quizWaterTarget.name, lat: c.lat, lng: c.lng },
      pool: pool.map((it) => { const m = it.bounds.getCenter(); return { name: it.name, lat: m.lat, lng: m.lng }; }),
      pick: handleWaterNameGuess,
    };
  }
  return null;
}
function showNameChoices(): void {
  const round = activeNameRound();
  if (!round || app.quizAnswered) return;
  // Distractors drawn from the ~14 nearest features, so they're regionally
  // plausible (the feature is marked on the map) but vary between attempts.
  const near = nearestDistractors(round.target, round.pool, 14);
  const options = buildOptions(round.target.name, near);
  renderChoices(options.map((name) => ({ label: name, pick: () => round.pick(name) })));
}
// The active "Which country" round as {correct countries, anchor point, handler}.
function activeCountryRound(): { correct: Set<CountryEntry>; correctName: string; anchor: NamedPoint; pick: (e: CountryEntry) => void } | null {
  if (app.quizType === "peakcountry" && app.quizPeak) {
    const correct = app.quizPeak.iso.map((c) => byIso[c]).filter(Boolean) as CountryEntry[];
    if (!correct.length) return null;
    return { correct: new Set(correct), correctName: correct[0].name, anchor: { name: "", lat: app.quizPeak.lat, lng: app.quizPeak.lng }, pick: handlePeakCountryGuess };
  }
  if (app.quizType === "citycountry" && app.quizCity) {
    const c = byIso[app.quizCity.iso];
    if (!c) return null;
    return { correct: new Set([c]), correctName: c.name, anchor: { name: "", lat: app.quizCity.lat, lng: app.quizCity.lng }, pick: handleCityCountryGuess };
  }
  if ((app.quizType === "rivercountry" || app.quizType === "lakecountry") && quizWaterTarget && quizWaterCountries.length) {
    const m = quizWaterTarget.bounds.getCenter();
    return { correct: new Set(quizWaterCountries), correctName: quizWaterCountries[0].name, anchor: { name: "", lat: m.lat, lng: m.lng }, pick: handleWaterCountryGuess };
  }
  return null;
}
// Shared country multiple-choice: the correct country (correct[0]) plus four
// distractor countries near `anchor`, excluding every correct country so a "near"
// option can't accidentally be right. Picking one answers via `pick`.
function showEntryChoices(correct: CountryEntry[], anchor: NamedPoint, pick: (e: CountryEntry) => void): void {
  if (app.quizAnswered || !correct.length) return;
  const correctSet = new Set(correct);
  const pool = realCountries()
    .filter((c) => !correctSet.has(c))
    .map((c) => { const ll = layerCenter(c); return ll ? { name: c.name, lat: ll[0], lng: ll[1] } : null; })
    .filter(Boolean) as NamedPoint[];
  const near = nearestDistractors(anchor, pool, 14);
  const options = buildOptions(correct[0].name, near);
  const byName = (n: string) => realCountries().find((c) => c.name === n);
  renderChoices(options.map((name) => ({ label: name, pick: () => { const e = byName(name); if (e) pick(e); } })));
}
function showCountryChoices(): void {
  const round = activeCountryRound();
  if (round) showEntryChoices([...round.correct], round.anchor, round.pick);
}
// The Countries-section locate rounds (flag / capital / spot): the target country
// itself is the answer, picked via handleGuess.
function showLocateChoices(): void {
  if (!helpableLocate() || !app.quizTarget) return;
  const ll = layerCenter(app.quizTarget);
  if (!ll) return;
  showEntryChoices([app.quizTarget], { name: app.quizTarget.name, lat: ll[0], lng: ll[1] }, handleGuess);
}
// Help button entry point: show the right option list for the active round.
export function showChoices(): void {
  if (isCountryAnswerQuiz()) showCountryChoices();
  else if (helpableLocate()) showLocateChoices();
  else showNameChoices();
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
  const missed = Array.from(app.quizNeighbourSet).filter((n) => !app.nbSelected.has(n));
  const wrong = Array.from(app.nbSelected).filter((p) => !app.quizNeighbourSet.has(p));
  const ok = missed.length === 0 && wrong.length === 0;
  scoreAnswer(ok);
  const total = app.quizNeighbourSet.size;
  let msg = "Found " + (total - missed.length) + " of " + total +
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
  revealSurroundings();
}

export function handleGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || !app.quizTarget || app.quizAnswered || entry.isLandmass) return;
  app.quizGuess = entry;
  app.quizAnswered = true;
  const ok = entry === app.quizTarget;
  const pts = scoreAnswer(ok);
  endCountryAnswer([app.quizTarget], entry); // lock search + settle any choice buttons
  quizLayer.clearLayers();
  if (ok) {
    quizFeedbackEl.className = "correct";
    quizFeedbackEl.textContent = "Correct! It's " + app.quizTarget.name + "." + pointsNote(pts);
  } else {
    quizFeedbackEl.className = "wrong";
    // Wrapped in a single <span> so the grid sees one text cell (the badge is the
    // other) — otherwise the link/text split into separate grid columns.
    quizFeedbackEl.innerHTML = "<span>You selected " + escapeHtml(entry.name) +
      ', the correct answer is <a href="#" class="quiz-zoom">' + escapeHtml(app.quizTarget.name) + "</a>." + pointsNote(pts) + "</span>";
    const z = quizFeedbackEl.querySelector(".quiz-zoom");
    if (z) z.addEventListener("click", (ev) => { ev.preventDefault(); zoomToTarget(8); });
  }
  // Green dot on the right country; red dot on the wrong pick + a line between.
  revealCountryDots([app.quizTarget], ok ? null : entry);
  renderQuizScore();
  quizNextBtn.disabled = false;
  refreshPolygons();
  revealSurroundings();
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
  app.quizDotCountries.add(entry.name); // its name is shown here, so skip the plain reveal label
  markDot(latlng, flag + nameLink(entry.name, wikiUrl(entry.name)), kind);
}
// After an answer, reveal the surrounding real names so the user can orient. The
// reveal functions gate on quizRevealsCountries()/quizRevealsCities(), and skip
// any country/city that already carries a reveal dot.
function revealSurroundings(): void {
  refreshCountryLabels();
  refreshCities();
  refreshPeaks();
  refreshRivers();
  refreshLakes();
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
    app.quizStarted = true; // best scores persist; entering Challenge opens the Start screen
    selectCategory(scoreCat); // sync the Start UI to the current selection
    showStart();
  } else {
    // Explore (browse) and Practice (guess) use the feature layers, not the quiz
    // layers — clear any leftover quiz reveals.
    quizLayer.clearLayers();
    quizContLayer.clearLayers();
  }
  hooks.refreshAll();
}

// Reflect the restored round length on the size buttons (the bests follow the
// current selection and are refreshed by updateStartBest on Start entry).
syncRoundSizeButtons();
