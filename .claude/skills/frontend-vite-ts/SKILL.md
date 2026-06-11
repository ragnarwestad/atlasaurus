---
name: frontend-vite-ts
description: Conventions for Ragnar's frontend projects — Vite + TypeScript (often single-file via vite-plugin-singlefile), pnpm, with a verify-then-commit workflow. Use when creating or editing a Vite/TS web app, a Leaflet/D3/Canvas/SVG visualization, or any browser app under ~/development.
---

# Frontend (Vite + TypeScript) conventions

Apply these when building or modifying a browser app in `~/development`.

## Stack & tooling
- Package manager: **pnpm** (not npm/yarn). Commit `pnpm-lock.yaml`.
- Build: **Vite + TypeScript**. For a single-file deliverable use
  `vite-plugin-singlefile` (outputs one self-contained `dist/index.html`).
- Keep source in `src/`, split into small typed modules (config, helpers, app/main).
  `src/` is the single source of truth.

## Workflow for every change
1. Edit `src/` (+ `index.html` / `vite.config.ts`).
2. `pnpm typecheck` (`tsc --noEmit`) must pass.
3. `pnpm build` must succeed.
4. Commit one logical change with a short, imperative message.

- Never commit `dist/`, `node_modules/`, or prebuilt bundles — gitignore them.
- `node_modules` is platform-specific; install/verify locally.

## pnpm 10/11 gotcha
If `pnpm build` aborts with `ERR_PNPM_IGNORED_BUILDS` (e.g. for esbuild), add to
`pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - esbuild
verifyDepsBeforeRun: false
```

## Style (per Ragnar's global preferences)
- Concise, decision-oriented. Lead with the problem, then the solution.
- Prefer small typed modules; avoid unused dependencies.
- Flag assumptions worth pressure-testing before sharing.
- When citing a measurement/figure, name the source dataset/document.

## Interactive-map / canvas pitfalls (learned the hard way)
- **Hover that reveals an interactive element overlapping the clickable target**
  (e.g. a label on top of a map polygon) creates a mouseover/mouseout flicker loop
  that swallows clicks. Prefer an off-element floating info panel for hover; reveal
  interactive labels on click/select instead.
- **Don't re-append DOM nodes during hover/refresh** (e.g. Leaflet `bringToFront()`);
  moving a node between mousedown and mouseup cancels the click.
- For polygon label placement use a pole-of-inaccessibility (e.g. `polylabel`), not
  a bounding-box center (which lands wrong for antimeridian-spanning shapes).
- Unwrap longitudes across the antimeridian before area/centroid math.

## Data
- Prefer stable static datasets on a CDN (e.g. jsDelivr `gh/...`) over live APIs that
  can deprecate. Provide a `raw.githubusercontent.com` fallback URL.
