# Atlasaurus

An interactive world map: every country with borders and its national capital,
clickable Wikipedia links on country, capital and territory names, plus flags
and a "satellite" connector view for detached parts and overseas territories.

Built with **Vite + TypeScript** and bundled into a single self-contained HTML
file. Geodata and flag images are fetched from CDNs at runtime, so the map needs
internet access when opened.

## Develop & build

Uses **pnpm**.

```bash
pnpm install      # install dependencies
pnpm dev          # start the dev server (hot reload)
pnpm build        # bundle everything into dist/index.html (single file)
pnpm preview      # preview the production build
pnpm typecheck    # run the TypeScript type checker (tsc --noEmit)
```

`pnpm build` produces `dist/index.html` — one self-contained file (HTML + CSS +
JS + Leaflet inlined) that you can open directly in a browser. `dist/` is
git-ignored; build it when you need the standalone file.

## Project structure

```
index.html            # Vite entry: sidebar markup + #map, loads src/main.ts
src/
  main.ts             # app: map, layers, state, refresh pipeline, data loading, UI
  config.ts           # data source URLs, Wikipedia overrides, polygon styles, tuning
  geo.ts              # geometry: areas, antimeridian unwrap, polygon parts, visual center
  wiki.ts             # Wikipedia URL builders + HTML escaping
  styles.css          # all styling
  polylabel.d.ts      # type declaration for the polylabel package
vite.config.ts        # Vite + vite-plugin-singlefile (inline everything)
```

## Features

- Two modes (top of the sidebar):
  - **Explore** — everything below.
  - **Quiz** — several rounds with a running score: identify a country prompted by
    name, flag or capital (answer by **Click on map** or **Select country** search);
    pick a country's continent; or select all
    of a country's neighbours and Check ("Neighbour"). The neighbour round offers
    two ways to answer (radio): **Click on map** or **Select countries** (search by
    name). Answers are revealed on the map (correct green, wrong red) with flags/names.
- All countries with borders and one national capital each.
- **Sidebar, two tabs:**
  - **Countries** — searchable list; click a country to zoom + select it.
  - **Continents** — the seven continents (incl. Antarctica); click one to
    highlight all its members on the map and show aggregate facts, and expand it
    to list its member countries.
  - **Sort** by Name, Population or Area (applies to both tabs); when sorting by
    population/area the value is shown after each name (compact, 2 decimals).
- **Map display toggles:** country names, capitals, flags, mountain peaks, major
  rivers and lakes. On the Regions tab these toggles apply only to the selected region.
- **Hover** shows a small panel that follows the cursor (flag · name · capital);
  the hovered country is highlighted.
- **Select a country** (map or list) to: highlight it, open a fact panel
  (capital, population, area, GDP, currency, languages, region; the title links to
  Wikipedia), and draw dashed connector lines to its "satellites":
  - detached parts of the same country (Alaska, Hawaii, French Guiana, Réunion…),
    labelled from Natural Earth sub-units;
  - separate territories under the same sovereign (Greenland & Faroe for Denmark;
    Falklands, Gibraltar, Bermuda… for the UK).
  The fact panel also lists those territories (scrollable, each Wikipedia-linked).
- Selecting a country **inside a highlighted continent** keeps the continent green
  with the country shown selected (orange) on top.
- Flags scale with zoom (smaller when zoomed out); click the background (ocean) to
  clear the selection.
- Country/capital/territory/continent names all link to English Wikipedia.

## Data sources (loaded at runtime via jsDelivr)

- **Borders:** Natural Earth `ne_10m_admin_0_countries_ukr` (Ukraine point-of-view,
  so Crimea is shown as part of Ukraine per UN GA Res. 68/262).
- **Capitals:** Natural Earth `ne_50m_populated_places_simple` (`Admin-0 capital`).
- **Sub-units:** Natural Earth `ne_10m_admin_0_map_subunits` (satellite labels).
- **Rivers:** Natural Earth `ne_50m_rivers_lake_centerlines` (loaded lazily when the
  Rivers toggle is first switched on).
- **Lakes:** Natural Earth `ne_50m_lakes` (loaded lazily with the Lakes toggle).
- **Mountain peaks:** a small curated list in `src/peaks.ts` (name, ISO country
  codes, elevation, coordinates; figures from Wikipedia / Britannica).
- **Flags:** [flagcdn.com](https://flagcdn.com) by ISO 3166-1 alpha-2 code.
- **Country facts:** population, GDP and region come from the Natural Earth border
  properties; area, currency, languages and the authoritative **continent**
  assignment from the [mledoze/countries](https://github.com/mledoze/countries)
  static dataset (loaded once at startup, then cached).

## Libraries

- [Leaflet](https://leafletjs.com/) — map engine
- [polylabel](https://github.com/mapbox/polylabel) — visual-center label placement
- [CARTO](https://carto.com/) light basemap tiles (runtime)

## Notes

- Crimea follows the internationally recognized border (Ukrainian).
- Dependencies/territories are filtered out of the base map to reduce clutter,
  but are reachable via the sovereignty connector lines.
- **Antarctica** is shown as a continent (landmass + Continents tab), not listed
  as a country.
- Continents come from mledoze, so every country falls into one of the seven
  (Natural Earth's "Seven seas (open ocean)" islands are reassigned).
- Some capital links use disambiguation overrides (e.g. Kingston → Kingston, Jamaica).
