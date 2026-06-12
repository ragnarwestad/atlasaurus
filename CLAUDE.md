# World Map — project guide for Claude

Interactive single-file world map. **Vite + TypeScript**, bundled to one
self-contained HTML file. Geodata/flags are fetched from CDNs at runtime.

## Workflow — do this for every change
1. Edit source under `src/` (and `index.html` / `vite.config.ts`).
2. Verify before committing: `pnpm typecheck` (must pass), `pnpm test`
   (Vitest, must pass) **and** `pnpm build` (must succeed).
3. Commit one logical change with a short, descriptive message.

- `src/` is the single source of truth.
- **Never commit** `dist/`, `node_modules/`, or a prebuilt `atlasaurus.html` — all are build artifacts / git-ignored.
- Package manager is **pnpm** (lockfile: `pnpm-lock.yaml`). Don't use npm/yarn.

## Tests (Vitest)
- Unit tests live next to the source (`src/*.test.ts`), run with `pnpm test`.
  Config is `vitest.config.ts` (standalone — deliberately does NOT share
  `vite.config.ts`; the singlefile plugin is build-only).
- Scope: the **pure helpers only** — `geo.ts` (incl. `lineLengthKm`), `wiki.ts`,
  and the `state.ts` helpers (`fmtInt`, `popOf`, `areaOf`, `layerCenter`,
  `placeMinZoom`, …). New pure logic should be placed in (or exported from)
  these modules so it stays testable.
- `map.ts` runs `L.map("map")` at import time — anything importing it
  (countries/panel/labels/physical/places/regions/sidebar/quiz/main) is NOT
  unit-testable; interaction behaviour is covered by the manual browser
  smoke-test instead. Environment is `happy-dom` so importing Leaflet works.

## pnpm notes
- `pnpm-workspace.yaml` sets `onlyBuiltDependencies: [esbuild]` and `verifyDepsBeforeRun: false`.
  These are required so `pnpm build` doesn't abort with `ERR_PNPM_IGNORED_BUILDS`
  over esbuild's install script. Keep them.
- `node_modules` is platform-specific — don't copy it between machines; reinstall.

## Architecture — where things live
- `index.html` — sidebar markup (Map section + Countries/Continents tabs), `#map`,
  info panels, help modal; loads `src/main.ts`.
- `src/main.ts` — entry point only: imports the modules, defines the `refreshAll()`
  coordinator (assigned to `hooks.refreshAll`), wires all DOM event listeners and
  kicks off `loadBorders()`.
- `src/state.ts` — **shared mutable state**: the single exported `app` object
  (selection/hover, toggles, quiz state, `sortBy`, `activeTab`, `groupScheme`, …),
  the collections (`countries`, `byIso`, `capitalMarkers`, `subunitsByIso`,
  `territoriesBySov`), shared types (`CountryEntry`, …), `hooks` (cross-module
  callbacks — modules call `hooks.refreshAll()`, never import `refreshAll` directly),
  and small shared helpers (`fmtInt`, `fetchJson`, `realCountries`, `popOf`,
  `areaOf`, `layerCenter`, `loadCountryData` for mledoze data). ES module imports
  are read-only bindings, so mutable flags MUST live as `app.x` properties.
- `src/map.ts` — Leaflet singletons: the `L.map` instance, tile layer, all
  `L.layerGroup`s and `cityCanvas`. Pure setup, no logic.
- `src/countries.ts` — borders load (`loadBorders` incl. hover/click handlers),
  **paint/visibility** (`styleForLayer`: selected=orange, continent member=green,
  realm sibling, hover, base; `countryVisible`: isolate hides non-selection;
  `inToggleScope`, `isRevealed`, `sameRealm`), `refreshPolygons`, **selection**
  (`selectLayer`, `selectContinent`, `deselect` — selecting a country keeps the
  continent highlight), and **connectors** (`computeConnectors` — shared by the
  dashed lines AND the fact panel's "Territories" list, so they never drift;
  `refreshConnectors`), plus `loadSubunits`.
- `src/panel.ts` — detail boxes: cursor hover panel (`showHoverInfo`/`hideHoverInfo`/
  `trackMouse`), the country/continent fact panel (`updateInfoPanel`), the feature
  detail box (`renderFeatureInfo`), `makeDraggable`, `attachLabelClick`, `isNarrow`.
- `src/labels.ts` — on-map country name labels (`placeCountryLabels`,
  `refreshCountryLabels`), flags (`flagIcon`/`refreshFlags`/`updateFlagSizes`) and
  the zoom-gated label classes (`updatePeakLabels`).
- `src/physical.ts` — peaks (`refreshPeaks`, `peakIcon`, `peakCountryNames`,
  `updatePeakSizes`), rivers (`refreshRivers`) and lakes (`refreshLakes`), lazy-loaded.
- `src/places.ts` — capitals (`loadCapitals`, `refreshCapitals`) and the Cities
  layer (canvas dots + capped DOM labels, `scheduleCityUpdate`/`refreshCities`).
- `src/regions.ts` — region grouping (`groupOf`, `SCHEME_LABEL`,
  `rebuildRegionColors`/`app.regionHue`), `updateRegionLabels`, and the continent
  quiz tint/label tables (`CONTINENT_QUIZ_STYLES`, `CONTINENT_LABEL_POS`).
- `src/sidebar.ts` — `buildSidebar` (flat list), `buildContinentList`, `applyFilter`,
  `cmpCountries` (sort), `setActiveTab`, `markActiveContinent`, fold state.
- `src/quiz.ts` — everything quiz: `nextQuestion`, the locate/neighbour/continent/
  peak rounds, answer handlers, `addQuizDot`, `setMode` (Explore↔Quiz), `setQuizCat`.
- `src/geo.ts` — geometry: ring area, antimeridian unwrap (`normRing`/`wrapLng`),
  `allPolygonParts`, `centerOf` (polylabel pole-of-inaccessibility).
- `src/config.ts` — data-source URLs, Wikipedia/city overrides, polygon styles, tuning.
- `src/wiki.ts` — Wikipedia URL builders + `escapeHtml`.
- `src/styles.css` — all styling.

**Central pipeline:** `refreshAll()` (main.ts) → refreshPolygons / refreshConnectors /
refreshCountryLabels / refreshCapitals / refreshFlags / refreshPeaks / refreshRivers /
refreshLakes / refreshCities / updateInfoPanel / markActiveContinent /
updateRegionLabels. Hover uses a lighter path (refreshPolygons + hover panel).
Modules trigger a full refresh via `hooks.refreshAll()` — never import it.

## Interaction gotchas — don't regress these
- On-map labels reveal on **select**, not hover. Hover info is an off-map floating
  panel. On-map hover-reveal of interactive labels over polygons caused a
  mouseover/mouseout flicker loop that swallowed clicks — don't reintroduce it.
- Don't call `bringToFront()` in hover/refresh paths — re-appending a path
  mid-interaction cancels clicks. Only in `selectLayer`.
- Country clicks call `L.DomEvent.stop(e)` and set `suppressMapClick` so the
  background-click deselect doesn't also fire.
- For label placement use `centerOf` (polylabel), never Leaflet
  `getBounds().getCenter()` (lands mid-Atlantic for USA/Russia).

## Domain rules
- **Crimea = Ukraine** (Natural Earth `ne_10m_admin_0_countries_ukr`, UN GA Res. 68/262).
- **Antarctica is a continent** (landmass + Continents tab), not a country — excluded
  from the Countries list/count.
- Continents come from **mledoze/countries** (seven continents; no "Other"/"Seven seas").
- Dependencies/territories are filtered from the base map but reachable via connector
  lines and sovereignty links (`SOV_A3`).

## Runtime data (CDN, needs internet)
Natural Earth (borders/capitals/subunits via jsDelivr), mledoze/countries
(area/currency/languages/continent), flagcdn (flags), Leaflet, CARTO tiles.
