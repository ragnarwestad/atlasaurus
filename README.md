# World Map

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

- All countries with borders and one national capital each.
- Country, capital and territory names link to English Wikipedia.
- Sidebar with two tabs: **Countries** (searchable A–Z list; click to zoom/select)
  and **Continents** (click a continent to highlight all its member countries on
  the map and show aggregate facts: countries, population, area, GDP).
- Toggles: country names, capitals, flags, and "isolate selected country".
- Hover/select reveal: hovering or selecting a country shows its name, capital
  and flag even when those toggles are off.
- Selecting a country draws dashed connector lines to its "satellites":
  - detached parts of the same country (Alaska, Hawaii, French Guiana, Réunion…),
    labelled from Natural Earth sub-units;
  - separate territories under the same sovereign state (Greenland & Faroe for
    Denmark; Falklands, Gibraltar, Bermuda… for the UK).
- **Isolate** mode hides all other countries to highlight a country and its parts.
- Flags scale with zoom; click the background (ocean) to clear the selection.
- Hovering a country shows a small floating panel (flag · name · capital) at the cursor.
- Selecting a country opens a fact panel: capital, population, area, GDP, currency,
  languages, region — plus a Wikipedia link.

## Data sources (loaded at runtime via jsDelivr)

- **Borders:** Natural Earth `ne_10m_admin_0_countries_ukr` (Ukraine point-of-view,
  so Crimea is shown as part of Ukraine per UN GA Res. 68/262).
- **Capitals:** Natural Earth `ne_50m_populated_places_simple` (`Admin-0 capital`).
- **Sub-units:** Natural Earth `ne_10m_admin_0_map_subunits` (satellite labels).
- **Flags:** [flagcdn.com](https://flagcdn.com) by ISO 3166-1 alpha-2 code.
- **Country facts:** population, GDP, region come from the Natural Earth border
  properties; area, currency and languages from the
  [mledoze/countries](https://github.com/mledoze/countries) static dataset
  (loaded once, on the first selection).

## Libraries

- [Leaflet](https://leafletjs.com/) — map engine
- [polylabel](https://github.com/mapbox/polylabel) — visual-center label placement
- [CARTO](https://carto.com/) light basemap tiles (runtime)

## Notes

- Crimea follows the internationally recognized border (Ukrainian).
- Dependencies/territories are filtered out of the base map to reduce clutter,
  but are reachable via the sovereignty connector lines.
- Some capital links use disambiguation overrides (e.g. Kingston → Kingston, Jamaica).
