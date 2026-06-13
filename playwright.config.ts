import { defineConfig } from "@playwright/test";

// E2E tests run against the dev server (auto-started below) in the system
// Chrome — no bundled browser download, so `pnpm-workspace.yaml`'s
// build-script restriction doesn't block setup. Keep these tests offline-safe:
// the app pulls geodata from CDNs at runtime, so assert on static UI (the help
// modal, toggles, sidebar structure) rather than data-dependent counts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list", // never the html reporter — it spawns a server that won't exit
  use: {
    baseURL: "http://localhost:5173",
    channel: "chrome",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
