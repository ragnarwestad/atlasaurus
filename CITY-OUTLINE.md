# City outline — problem statement & handoff

> Status: **live-verified green** (2026-06-12): `pnpm test:live` passes 25/25 from a
> real shell — every asserted city resolves to a containing, city-sized boundary
> (observed spans 22–49 km; sources `reverse` / `addr:municipality`). The algorithm
> itself needed **no** changes: every red in earlier runs (including the partial
> browser-driven run that resolved 17 of 32 before being blocked) was Nominatim
> **429 throttling**, not a resolution bug — see "Constraints" below for the
> root cause and the harness fixes. Tokyo policy is now **settled** (show the dot, no
> outline — see "Likely fixes / tunables"). Remaining open: widening the verified
> subset toward the ~7k cities.

## The problem we're solving

When a city is selected (clicked on the map, or picked from the **Cities** list, or
clicked as a **Capitals** marker) the app draws the city's **administrative
boundary** as an orange outline. Source: **OpenStreetMap via the Nominatim API**,
fetched on demand.

This replaced an earlier attempt using Natural Earth `ne_10m_urban_areas`. That was
dropped because NE urban areas are *fragmented satellite-detected built-up blobs*
with no names: a metro is many separate polygons, so a point-in-polygon match drew
only one fragment (e.g. only part of NYC, missing Manhattan), and a radius wide
enough to capture a real metro also jumped the Øresund and grabbed Malmö/Helsingborg
for Copenhagen. Administrative boundaries (one clean polygon per city) are the right
primitive — hence Nominatim.

**Caveat to keep in mind:** an admin boundary is *not* the built-up area. Oslo
kommune includes the Nordmarka forest; Copenhagen kommune excludes Frederiksberg and
the suburbs. That's "correct" but can look different from the populated footprint.

## Why it's hard (the Nominatim quirks we hit)

Nominatim's `/search` and `/reverse` don't straightforwardly return "the city
boundary". Observed behaviour:

1. **Big cities reverse-geocode to a *point*.** For a prominent `place=city` node,
   `/reverse?zoom=10` returns the node (Point geometry), not the municipality
   polygon. Diagnostic from the app:
   - `Sorø, Denmark @ 55.43,11.57` → reverse returns **Polygon** ✓
   - `København, Denmark @ 55.68,12.56` → reverse returns **none** (a Point) ✗
2. **Name search misses non-matching boundary names.** The boundary for Copenhagen
   is named **"Københavns Kommune"**, so a search for "København"/"Copenhagen" never
   surfaces it (it returns the place point). This is why all Danish cities failed at
   first while Sweden/Germany worked (there the city and its boundary share a name).
3. **De-duplication hides the boundary.** With the default `dedupe=1`, Nominatim
   collapses the city point and its boundary relation to whichever ranks higher
   (often the point). `dedupe=0` keeps both.
4. **Ambiguous names return the wrong level.** "New York" → New York *State*;
   "Tokyo" → Tokyo *Metropolis/prefecture*. These are huge and must be rejected in
   favour of the city-level polygon.
5. **The Capitals layer had its own click path** that never called the outline code,
   so capitals (Copenhagen, Oslo, …) silently got no outline regardless of the above.
   Fixed: capital markers now call `showCityOutline` too.

## Current resolution algorithm

All the Nominatim + geometry logic lives in **`src/cityBoundary.ts`** (pure, no
Leaflet/DOM, so it's unit-testable). `src/places.ts` only draws what it returns.

`resolveCityBoundary(lat, lng, name, adm0)` does, in order:

1. `GET /reverse?zoom=10&polygon_geojson=1` at the city's coordinates.
   - If it returns a **polygon ≤ `MAX_CITY_KM`** → use it. (Works for most towns,
     e.g. Sorø.) Coordinate-based, so it's name-independent.
2. If reverse returned a point, read its **`address`** (still present) and search the
   named admin unit, preferring `municipality` → `city` → `town` → `county`:
   `GET /search?dedupe=0&polygon_geojson=1&q=<name>, <country>`. This is what fixes
   Copenhagen ("Københavns Kommune" comes from the address).
3. Fallback: free-form `/search` on the city name itself.

`/search` results are filtered by **`searchPick`**: take the first result that is a
Polygon/MultiPolygon, is **≤ `MAX_CITY_KM` across**, AND **contains the city point**.
This is what rejects New York State / Tokyo prefecture and keeps "City of New York".

Returns `{ geom, source }` where `source ∈ reverse | addr:municipality | addr:city |
addr:town | addr:county | name-search | none`.

## What's verified vs. open

- **Verified manually:** Sorø, Hillerød, Aarhus, Copenhagen (after the address-search
  + capital-path fixes); New York and Tokyo handled by the size/containment filter
  (Tokyo resolves to *no outline* by design — see below).
- **Unit-tested (mocked fetch), `src/cityBoundary.test.ts`:** reverse-direct,
  address-municipality fallback (Copenhagen shape), oversized-state rejection (NY
  shape), oversized-only → none (Tokyo shape), non-containing rejection, and the pure
  helpers `geomExtentKm` / `geomContains`.
  ⚠️ These only check our *branching logic* against assumed response shapes — they
  would **not** have caught the real bugs, which were all about Nominatim's actual
  behaviour. They're a regression guard + documentation, nothing more.
- **Live-verified (2026-06-12, `pnpm test:live`):** all 25 cities in the integration
  test pass — containing, city-sized polygons with sane spans (22–49 km where logged).
  No algorithm changes were needed; the earlier reds were all 429 throttling.
- **Open:** the verified subset is still only ~25 notable cities out of ~7k. (Tokyo's
  policy is now settled — dot only; it stays logged-only (`hard`) as a canary.)

## The work to finish (the loop for Claude Code)

There's an opt-in live integration test: **`src/cityBoundary.integration.test.ts`**,
run with `pnpm test:live` (sets `RUN_LIVE=1`; skipped by default so normal CI stays
offline and fast). It hits real Nominatim for ~25 notable cities and asserts each
resolves to a **containing, ≤ `MAX_CITY_KM`** polygon, logging `name | source | span`.

Run this loop until green:

1. `pnpm test:live` — read the reds (and the LARGE/none logs).
2. For each failure, inspect the raw Nominatim response (open the `/reverse` and
   `/search` URLs in a browser, or `curl`) to learn the real shape.
3. Fix the algorithm in `src/cityBoundary.ts` (see tunables below).
4. **Capture the real response shape as a new mocked case in
   `src/cityBoundary.test.ts`** so that pattern can never regress.
5. Repeat. Expand the city list in the integration test as needed (it's a plain
   array near the top of the file).

### Likely fixes / tunables
- **`MAX_CITY_KM` (currently 120).** Too low drops legitimately large cities
  (Chongqing's administrative area is ~470 km); too high lets prefectures through.
  Consider making it adaptive (e.g. by population) instead of a flat cap.
- **Address candidate order** (`municipality → city → town → county`). Some countries
  may need a different preference, or an `addresstype`/`admin_level` check instead of
  a flat size cap.
- **Tokyo-style cities** with no clean city-level relation under the cap: **settled
  (2026-06-13) — show the dot, no outline.** Investigated live: the three options from
  the original handoff reduce to one workable answer.
  - *Accept the special-wards aggregate (区部)* — **not possible** via Nominatim:
    reverse jumps straight from ward (zoom 10 → 杉並区) to prefecture (zoom 9–6 → 東京都,
    span ~2500 km), never surfacing the 区部 level; name-search for `東京都区部` /
    `Special wards of Tokyo` returns only fulltext junk (schools, theme parks).
  - *A larger cap* — rejected: 東京都's bbox is ~2500 km because of the Izu/Ogasawara
    islands, so no flat cap captures it without also letting real prefectures through.
  - *Leave outline-less* — **chosen.** Every other pin draws its municipality; Tokyo
    has no reachable city boundary, so the dot alone is the honest, consistent result.
    Tokyo stays `hard` (logged, not asserted) in the integration test — kept as a
    canary: if OSM/Nominatim ever start returning a city-sized boundary for it, the
    logged span makes that visible and we can revisit.
- **Reverse `zoom`.** Fixed at 10 ("city"); the zoom→admin-level mapping varies by
  country, so a city might come back a notch too large/small. A small zoom cascade
  (10 → 8) with the size/containment filter could help.

## Constraints
- **Nominatim usage policy:** max ~1 request/second; the integration test paces
  itself and sends a `User-Agent`. Don't hammer it across all 7k cities (hours +
  likely a block) — test a representative subset.
- **429 throttling — what we learned (2026-06-12):**
  - vitest's `happy-dom` environment simulates browser CORS and sent an **OPTIONS
    preflight before every request** (triggered by the custom `User-Agent`), silently
    doubling the request rate to ~2/s — that's what got the IP blocked mid-run. The
    integration test now forces `@vitest-environment node` (no preflight).
  - The limiter is **window-based**, not just per-second: a full ~30-request run
    passes cleanly, but starting another one a minute later gets 429'd. Leave a few
    minutes between live runs. Blocks observed so far lift after ~5–10 minutes.
  - The test's fetch wrapper now **backs off 30 s and retries (×3)** on 429, so a
    transient throttle no longer masquerades as "no boundary found".
- **Rate-limit caching bug — fixed:** `outlineCache` in `places.ts` used to store
  `null` on failure, permanently caching "no outline" after a transient error.
  It now caches successful geometries only.

## Files
- `src/cityBoundary.ts` — resolution logic (edit here).
- `src/cityBoundary.test.ts` — mocked unit tests (add regression cases here).
- `src/cityBoundary.integration.test.ts` — live test (`pnpm test:live`).
- `src/places.ts` — `showCityOutline` / `drawOutlineGeom` / `clearCityOutline`,
  capital + city + list click paths, `cityOutlineLayer`.
- `src/map.ts` — `cityOutlineLayer` (drawn under the city dots).
- `src/state.ts` — `hooks.clearCityOutline` (cleared on other selections via
  `panel.renderFeatureInfo` and `countries.deselect/selectLayer/selectContinent`).

## Commands
- `pnpm test` — mocked unit tests (offline, fast).
- `pnpm test:live` — live Nominatim integration test (the real verification).
- `pnpm typecheck` && `pnpm build` — before committing, per project convention.
