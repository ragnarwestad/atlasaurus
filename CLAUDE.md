# World Map — project guide for Claude

Interactive single-file world map. **Vite + TypeScript**, bundled to one
self-contained HTML file. Geodata/flags are fetched from CDNs at runtime.

## Workflow — do this for every change
1. Edit source under `src/` (and `index.html` / `vite.config.ts`).
2. Verify before committing: `pnpm typecheck` (must pass) **and** `pnpm build` (must succeed).
3. Commit one logical change with a short, descriptive message.

- `src/` is the single source of truth.
- **Never commit** `dist/`, `node_modules/`, or a prebuilt `atlasaurus.html` — all are build artifacts / git-ignored.
- Package manager is **pnpm** (lockfile: `pnpm-lock.yaml`). Don't use npm/yarn.

## pnpm notes
- `pnpm-workspace.yaml` sets `onlyBuiltDependencies: [esbuild]` and `verifyDepsBeforeRun: false`.
  These are required so `pnpm build` doesn't abort with `ERR_PNPM_IGNORED_BUILDS`
  over esbuild's install script. Keep them.
- `node_modules` is platform-specific — don't copy it between machines; reinstall.

## Architecture — where things live
- `index.html` — sidebar markup (Map section + Countries/Continents tabs), `#map`,
  info panels, help modal; loads `src/main.ts`.
- `src/main.ts` — the app:
  - **State:** `selectedLayer`, `selectedContinent`, `hoveredLayer`,
    `showNames/showCapitals/showFlags/isolate`, `sortBy`, `activeTab`, `expandedContinent`.
  - **Central pipeline:** `refreshAll()` → refreshPolygons / refreshConnectors /
    refreshCountryLabels / refreshCapitals / refreshFlags / updateInfoPanel /
    markActiveContinent. Hover uses a lighter path (refreshPolygons + hover panel).
  - **Selection:** `selectLayer` (country), `selectContinent`, `deselect`. Selecting
    a country keeps the continent highlight (country orange over green members).
  - **Paint/visibility:** `styleForLayer` (selected=orange, continent member=green,
    realm sibling, hover, base) and `countryVisible` (isolate hides non-selection).
  - **Connectors:** `computeConnectors` — shared by the dashed lines AND the fact
    panel's "Territories" list, so they never drift.
  - **Sidebar:** `buildSidebar` (flat list), `buildContinentList`, `applyFilter`,
    `cmpCountries` (sort), tab/sort wiring.
  - **Data loading:** `loadBorders`, `loadCapitals`, `loadSubunits`, `loadCountryData`
    (mledoze; also drives continent assignment).
- `src/geo.ts` — geometry: ring area, antimeridian unwrap (`normRing`/`wrapLng`),
  `allPolygonParts`, `centerOf` (polylabel pole-of-inaccessibility).
- `src/config.ts` — data-source URLs, Wikipedia/city overrides, polygon styles, tuning.
- `src/wiki.ts` — Wikipedia URL builders + `escapeHtml`.
- `src/styles.css` — all styling.

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
