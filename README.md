# World Map

An interactive world map: every country with borders and its national capital, where country and capital names link to their English Wikipedia articles.

Single self-contained file — `world-map.html` (HTML + CSS + JS, no build step). Open it in a browser; it needs internet access (libraries and geodata are loaded from CDNs at runtime).

## Features

- All countries with borders and one national capital each.
- Country names link to English Wikipedia; capital names link to the city article.
- Sortable, searchable country list (sidebar) that zooms to and selects a country.
- Toggles for showing country names and capitals on the map (off by default).
- Hover/select reveal: hovering or selecting a country shows its name + capital even when the toggles are off.
- **Isolate mode** (on by default): clicking a country hides all others and draws dashed connector lines from the main landmass to its satellites:
  - detached parts of the same country (e.g. Kaliningrad, Alaska, Hawaii), labelled from Natural Earth sub-units;
  - separate territories under the same sovereign state (e.g. Greenland & Faroe for Denmark; Falklands, Gibraltar, Bermuda for the UK).
- Click the background (ocean) to clear the selection.

## Data sources (loaded at runtime via jsDelivr)

- **Borders:** Natural Earth `ne_10m_admin_0_countries_ukr` (Ukraine point-of-view, so Crimea is shown as part of Ukraine per UN GA Res. 68/262).
- **Capitals:** Natural Earth `ne_50m_populated_places_simple` (filtered to `Admin-0 capital`).
- **Sub-units (for satellite labels):** Natural Earth `ne_10m_admin_0_map_subunits`.

## Libraries (CDN)

- [Leaflet](https://leafletjs.com/) 1.9.4 — map engine
- [polylabel](https://github.com/mapbox/polylabel) — visual-center placement for labels
- [CARTO](https://carto.com/) light basemap tiles

## Notes

- Crimea follows the internationally recognized border (Ukrainian).
- Dependencies/territories are filtered out of the base map to reduce clutter, but are reachable via the sovereignty connector lines in isolate mode.
- Some capital city links use disambiguation overrides (e.g. Kingston → Kingston, Jamaica).
