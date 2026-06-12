// Standalone Vitest config — deliberately NOT sharing vite.config.ts: the
// singlefile plugin is build-only and irrelevant for unit tests, and keeping
// them separate avoids Vite-major coupling between build and test runner.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // happy-dom gives `window`/`document` so modules that import Leaflet
    // (e.g. state.ts) can be loaded in tests. Modules with real map side
    // effects (map.ts and everything importing it) are NOT unit-testable —
    // keep tests to the pure helpers.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
