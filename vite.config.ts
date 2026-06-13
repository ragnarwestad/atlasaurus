import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import JavaScriptObfuscator from "javascript-obfuscator";

// Obfuscates the bundled JS before vite-plugin-singlefile inlines it into the
// HTML. Runs at renderChunk (after Vite's own minify), so the code that ends up
// in dist/index.html is aggressively obfuscated: variable renaming, string-array
// encoding, control-flow flattening and dead-code injection.
//
// NOTE: aggressive settings increase bundle size (~3-4x on the JS: 270kB -> ~990kB)
// and slow runtime. controlFlowFlattening/deadCodeInjection thresholds are kept
// below 1.0 to bound that cost. selfDefending is intentionally OFF: with it on,
// the bundle entered an infinite loop and froze the page (never reached
// DOMContentLoaded). Geodata/flags are still fetched from CDNs at runtime.
function obfuscate(): Plugin {
  return {
    name: "obfuscate-bundle",
    enforce: "post",
    renderChunk(code) {
      const result = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        identifierNamesGenerator: "hexadecimal",
        numbersToExpressions: true,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 8,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.85,
        transformObjectKeys: true,
        selfDefending: false,
        unicodeEscapeSequence: false,
      });
      return { code: result.getObfuscatedCode(), map: null };
    },
  };
}

// Bundles everything (HTML + CSS + JS + libs) into a single self-contained
// dist/index.html. Geodata and flag images are still fetched from CDNs at
// runtime, so an internet connection is required when the map is opened.
// Obfuscation is opt-in via OBFUSCATE=1 so plain `pnpm build` stays fast and
// debuggable; the obfuscated artifact is produced by `pnpm build:obf`.
const obfuscating = process.env.OBFUSCATE === "1";

export default defineConfig({
  plugins: [...(obfuscating ? [obfuscate()] : []), viteSingleFile()],
  build: {
    target: "es2019",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
  },
});
