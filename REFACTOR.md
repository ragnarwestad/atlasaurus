# Refactor plan — split `src/main.ts` into modules

> **Status: COMPLETED** (June 2026, 11 commits `3d37696`…`bfd9c87` + docs). The
> module layout below is now reality — see `CLAUDE.md` for the up-to-date map.
> This file is kept as the rationale record; safe to delete.

`src/main.ts` is ~2070 lines and mixes map setup, data loading, styling, the
detail/fact panels, the sidebar, all of the quiz, and the DOM wiring. This plan
breaks it into focused ES modules. **No framework** (we evaluated React/Preact and
chose a plain modular refactor — the bulk of the code is imperative Leaflet/data/
quiz logic that a UI framework wouldn't simplify).

This is a **pure refactor**: no behaviour changes. The built `dist/index.html`
should stay functionally identical. Work incrementally, one module at a time,
verifying and committing after each.

## The one decision that makes this work: shared mutable state

ES module imports are **live, read-only bindings** — you cannot do
`import { mode } from "./state"; mode = "quiz"` (compile error). All the mutable
flags in `main.ts` (`mode`, `showCities`, `showHover`, `selectedLayer`, the quiz
state, `countries[]`, `byIso`, `suppressMapClick`, …) must therefore live as
**properties of a single exported object**, not as bare `let`s:

```ts
// state.ts
export const app = {
  mode: "explore" as "explore" | "quiz",
  showCities: false,
  showHover: false,
  selectedLayer: null as L.Polygon | null,
  suppressMapClick: false,
  // …quiz state, etc.
};
export const countries: CountryEntry[] = [];      // arrays/maps can stay const
export const byIso: Record<string, CountryEntry> = {};
```

Then every module reads/writes `app.mode`, `app.selectedLayer`, etc. Do this
first; it's the backbone everything else depends on. (Alternative: setter
functions per flag — more boilerplate, same effect. Prefer the object.)

Keep `CountryEntry` and the other shared types in `state.ts` (or a `types.ts`
imported by it) so every module shares one definition.

## The `refreshAll` pipeline

`refreshAll()` currently calls `refreshPolygons / refreshConnectors /
refreshCountryLabels / refreshCapitals / refreshFlags / refreshPeaks /
refreshRivers / refreshLakes / refreshCities / updateInfoPanel /
markActiveContinent / updateRegionLabels`. Keep **one coordinator** that imports
each module's refresh fn and calls them in order (put it in `refresh.ts` or keep
it in `main.ts`). Modules must **not** call `refreshAll` themselves (circular dep);
if a module needs a full refresh after an action, have it call the coordinator
that main passes in, or emit through a tiny callback. Most modules only need to
expose their own `refreshX()`.

## Target module layout

- `map.ts` — the `L.map` instance, tile layer, all `L.layerGroup`s (capital, flag,
  peak, river, lake, city, cityLabel, quiz, quizCont, regionLabel) and `cityCanvas`.
  Pure singletons, no logic. **Extract first** (lowest risk).
- `state.ts` — shared types + the `app` state object + `countries`/`byIso`/
  `capitalMarkers` etc. (see above).
- `panel.ts` — detail boxes: `makeDraggable`, `renderFeatureInfo`, the country
  fact panel (`buildInfoHTML`, `renderCountryInfo`, `renderContinentInfo`,
  `updateInfoPanel`, collapse/`defaultPanelLayout`), and the cursor hover panel
  (`showHoverInfo` / `hideHoverInfo` / `positionHoverInfo`).
- `labels.ts` — `placeCountryLabels`, `flagIcon` / `refreshFlags` /
  `updateFlagSizes`, `refreshCountryLabels`, and `updatePeakLabels` (the
  zoom-gating class toggles for peak/river/lake labels).
- `physical.ts` — peaks (`peakIcon`, `peakSize`, `peakLabelOffset`,
  `buildPeakMarkers`, `refreshPeaks`, `peakCountryNames`), rivers (`loadRivers`,
  `refreshRivers`, `lineLengthKm`), lakes (`loadLakes`, `refreshLakes`).
- `places.ts` — capitals (`loadCapitals`, `refreshCapitals`, `CAPITAL_MAX`) and
  cities (`CityRec`, `loadCities`, `updateCities`, `scheduleCityUpdate`,
  `placeMinZoom`, the canvas dots + `attachLabelClick`).
- `regions.ts` — region grouping: `groupOf`, `GroupScheme`/`SCHEME_*`,
  `rebuildRegionColors`, `updateRegionLabels`, `groupLabelPos`, the continent
  quiz tint table (`CONTINENT_QUIZ_STYLES`, `CONTINENT_LABEL_POS`).
- `countries.ts` — borders load (`loadBorders` + `onEachFeature` incl. the click
  handler), `styleForLayer`, `countryVisible`/`inToggleScope`/`isRevealed`/
  `sameRealm`, selection (`selectLayer`, `selectContinent`, `deselect`),
  `refreshPolygons`, connectors (`computeConnectors`, `refreshConnectors`),
  capitals/subunits data hookups.
- `sidebar.ts` — `setActiveTab`, `updateListVisibility`, `makeCountryLi`,
  `buildSidebar`, `applyFilter`, `buildContinentList`, `markActiveContinent`,
  sort, fold toggles, the Group-by scheme dropdown.
- `quiz.ts` — everything quiz: `nextQuestion`, the locate quizzes, `handleGuess`,
  continent quiz (`answerContinent`, `showContinentLabels`), neighbour quiz,
  peak quiz, `addQuizDot`, score/prompt rendering, category/sub-type switching.
- `main.ts` — only: import modules, wire DOM event listeners, kick off
  `loadBorders()`, define the `refreshAll` coordinator (or import it).

`config.ts`, `geo.ts`, `wiki.ts`, `peaks.ts`, `polylabel.d.ts` already exist and
stay as-is.

## Suggested order (verify + commit after each)

1. `map.ts` (singletons).
2. `state.ts` (the `app` object + types + shared arrays). Biggest import churn —
   go slow, lean on the compiler.
3. `panel.ts`.
4. `labels.ts`.
5. `physical.ts`.
6. `places.ts`.
7. `regions.ts`.
8. `countries.ts`.
9. `sidebar.ts`.
10. `quiz.ts`.
11. `main.ts` shrinks to wiring + the `refreshAll` coordinator.

## Known gotchas (learned the hard way)

- **Circular deps:** `quiz.ts` reads quiz flags and `styleForLayer` from
  `countries.ts`, while `styleForLayer` reads quiz flags. Resolve by keeping all
  shared *state* in `state.ts`; functions read state from there, so the
  state→logic direction stays acyclic.
- **`suppressMapClick`** lives in `app` (state); feature click handlers set it
  before opening a panel so the map's background-click handler doesn't immediately
  deselect/close.
- **Map labels are plain text + `pointer-events: none`**; the feature
  (dot/line/polygon) or the label via `attachLabelClick` opens the detail box.
  Don't reintroduce `<a>` links into map labels (mobile accidental-tap problem).
- **Quiz reveal labels** (`addQuizDot`, `drawQuizPeak`) intentionally *do* link to
  Wikipedia — leave them.
- A formatter/editor reverted the `loadCities`/`updateCities` block a couple of
  times mid-edit during the original work. Commit frequently and re-read before
  editing if you suspect a revert.

## Verify each step

The repo uses **pnpm** locally:

```bash
pnpm typecheck   # tsc --noEmit
pnpm build       # vite build → dist/index.html (single file)
```

(During the original work the sandbox lacked pnpm and used a throwaway `npm
install` + `npx tsc --noEmit` + `npx vite build` in a /tmp copy — either is fine;
the point is **tsc clean + build succeeds** before every commit.)

There are no automated tests. After each commit, smoke-test in the browser:
toggles (names/capitals/cities/flags/mountains/rivers/lakes/hover), country
select + fact panel + territories, Regions tab + Group-by + map tint, all quiz
rounds (name/flag/capital/spot/neighbour/continent/mountains), and feature detail
boxes. Consider adding unit tests for the pure helpers (`geo.ts`, `lineLengthKm`,
`placeMinZoom`) as a cheap safety net.

## Guardrails

- Pure refactor — **no behaviour or styling changes** in the same commits.
- One module per commit, with a clear message.
- Follow the existing conventions in `CLAUDE.md` and the `frontend-vite-ts` skill
  (Vite + TS, single-file build via `vite-plugin-singlefile`, verify-then-commit).
