import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Bundles everything (HTML + CSS + JS + libs) into a single self-contained
// dist/index.html. Geodata and flag images are still fetched from CDNs at
// runtime, so an internet connection is required when the map is opened.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2019",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
  },
});
