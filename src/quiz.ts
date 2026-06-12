// Quiz mode: question generation and scoring for all rounds (name / flag /
// capital / spot / neighbour / continent / mountain peaks), the answer
// handlers, the reveal dots/lines on the map, and Explore↔Quiz mode switching.
import L from "leaflet";
import type { LatLng } from "./geo";
import { wikiUrl, escapeHtml } from "./wiki";
import { PEAKS } from "./peaks";
import { map, quizLayer, quizContLayer } from "./map";
import {
  app, hooks, byIso, realCountries, layerCenter, fmtInt, loadCountryData,
  type CountryEntry, type QuizType,
} from "./state";
import { hideHoverInfo } from "./panel";
import { peakIcon, peakCountryNames } from "./physical";
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

export function nextQuestion(): void {
  // The neighbour quiz needs the borders dataset; load it first if necessary.
  if (app.quizType === "neighbour" && !app.countryData) {
    loadCountryData().then(() => nextQuestion()).catch(() => { /* ignore */ });
    return;
  }
  if (app.quizType === "peakname" || app.quizType === "peakcountry") { nextPeakQuestion(); return; }
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
    quizFeedbackEl.textContent = "Click any country in its continent on the map.";
  } else if (app.quizType === "neighbour") {
    quizChoicesEl.hidden = true;
    locBox.hidden = true;
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
    quizChoicesEl.hidden = true;
    quizContLayer.clearLayers();
    nbBox.hidden = true;
    locInput.value = ""; locInput.disabled = false;
    locResults.innerHTML = "";
    locBox.hidden = false;
    locModeEl.hidden = true;     // always answered by typing the name
    app.locMode = "search";
    applyLocMode();
    const c = app.quizTarget ? layerCenter(app.quizTarget) : null;
    map.setView([20, 0], 2);
    if (c) L.circleMarker(c, { radius: 9, color: "#8a3b00", weight: 3, fillColor: "#e8740c", fillOpacity: 0.9 }).addTo(quizLayer);
    quizFeedbackEl.textContent = "Which country is highlighted? Type its name.";
  } else {
    quizChoicesEl.hidden = true;
    quizContLayer.clearLayers();
    nbBox.hidden = true;
    locInput.value = ""; locInput.disabled = false;
    locResults.innerHTML = "";
    locBox.hidden = false;
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
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
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
function renderPeakChoices(): void {
  if (!app.quizPeak) return;
  const distract = shuffle(PEAKS.filter((p) => p !== app.quizPeak)).slice(0, 3);
  quizChoicesEl.innerHTML = "";
  shuffle([app.quizPeak, ...distract]).forEach((p) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.name; b.dataset.peak = p.name;
    b.addEventListener("click", () => handlePeakNameGuess(p.name));
    quizChoicesEl.appendChild(b);
  });
}
function nextPeakQuestion(): void {
  const pool = app.quizType === "peakcountry" ? PEAKS.filter((p) => p.iso.length) : PEAKS;
  if (!pool.length) return;
  let p = app.quizPeak;
  for (let i = 0; i < 20 && (!p || p === app.quizPeak); i++) p = pool[Math.floor(Math.random() * pool.length)];
  app.quizPeak = p;
  app.quizTarget = null; app.quizGuess = null; app.quizAnswered = false;
  app.quizContCorrect = null; app.quizContWrong = null; app.quizNeighbourSet = new Set();
  nbBox.hidden = true; locBox.hidden = true;
  quizContLayer.clearLayers();
  renderQuizPrompt();
  quizFeedbackEl.className = "";
  if (app.quizType === "peakname") {
    renderPeakChoices();
    quizChoicesEl.hidden = false;
    quizFeedbackEl.textContent = "Which mountain is marked? Pick one.";
  } else {
    quizChoicesEl.hidden = true;
    quizFeedbackEl.textContent = "In which country is " + (app.quizPeak ? app.quizPeak.name : "") + "? Click it on the map.";
  }
  if (app.quizPeak) map.setView([app.quizPeak.lat, app.quizPeak.lng], 4);
  drawQuizPeak(false);
  quizNextBtn.disabled = true;
  refreshPolygons();
}
function handlePeakNameGuess(name: string): void {
  if (app.mode !== "quiz" || app.quizAnswered || !app.quizPeak) return;
  app.quizAnswered = true; app.quizTotal++;
  const ok = name === app.quizPeak.name;
  if (ok) app.quizCorrect++;
  quizChoicesEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.disabled = true;
    const n = btn.dataset.peak;
    if (n === app.quizPeak!.name) btn.classList.add("correct");
    else if (n === name && !ok) btn.classList.add("wrong");
  });
  quizFeedbackEl.className = ok ? "correct" : "wrong";
  quizFeedbackEl.textContent = (ok ? "✓ Correct! " : "✗ It's ") + app.quizPeak.name +
    " — " + fmtInt(app.quizPeak.elevation) + " m, " + peakCountryNames(app.quizPeak) + ".";
  renderQuizScore();
  quizNextBtn.disabled = false;
  drawQuizPeak(true);
}
export function handlePeakCountryGuess(entry: CountryEntry): void {
  if (app.mode !== "quiz" || app.quizAnswered || !app.quizPeak || entry.isLandmass) return;
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
  drawQuizPeak(true);
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

// --- Locate quizzes (name / flag / capital): answer by clicking the map or by
//     searching for the country by name. The two are mutually exclusive. ---
const locBox = document.getElementById("loc-box") as HTMLElement;
const locModeEl = document.getElementById("loc-mode") as HTMLElement;
export const locInput = document.getElementById("loc-input") as HTMLInputElement;
const locResults = document.getElementById("loc-results")!;

export function applyLocMode(): void {
  locBox.classList.toggle("map-mode", app.locMode === "map");
  if (app.locMode === "map") { locInput.value = ""; renderLocResults(""); }
  if (app.mode === "quiz" && isLocateQuiz() && !app.quizAnswered) {
    quizFeedbackEl.textContent = app.locMode === "map"
      ? "Click it on the map."
      : "Find and select the country.";
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
      li.addEventListener("click", () => { if (!app.quizAnswered) { locInput.value = ""; locResults.innerHTML = ""; handleGuess(c); } });
      locResults.appendChild(li);
    });
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
    if (!app.quizStarted) { app.quizStarted = true; app.quizCorrect = 0; app.quizTotal = 0; nextQuestion(); }
    renderQuizScore();
  }
  hooks.refreshAll();
}

// Top-level quiz category: "Country" (sub-types By name/flag/capital/Neighbour) or
// "Continent" (its own round — no sub-types).
const quizTypeEl = document.getElementById("quiz-type") as HTMLElement;
const mtnTypeEl = document.getElementById("mtn-type") as HTMLElement;
export function setQuizCat(cat: "country" | "continent" | "mountains"): void {
  document.querySelectorAll<HTMLElement>(".qc-tab").forEach((b) => { b.classList.toggle("active", b.dataset.cat === cat); });
  quizTypeEl.hidden = cat !== "country";
  mtnTypeEl.hidden = cat !== "mountains";
  if (cat === "continent") {
    app.quizType = "continent";
  } else if (cat === "mountains") {
    const active = document.querySelector<HTMLElement>("#mtn-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "peakname";
  } else {
    const active = document.querySelector<HTMLElement>("#quiz-type .qt-btn.active");
    app.quizType = (active && (active.dataset.qtype as QuizType)) || "name";
  }
  if (app.mode === "quiz") nextQuestion();
}
