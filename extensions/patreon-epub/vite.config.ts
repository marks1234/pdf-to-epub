/**
 * Build for the Patreon → EPUB Chrome extension:
 *
 *   vite build -c extensions/patreon-epub/vite.config.ts
 *
 * Emits dist/content.js (an IIFE — content scripts can't be ES modules) and
 * copies public/ (manifest.json). The EPUB is written by an eval-free writer
 * (src/epub-writer.ts), so the bundle must never contain `new Function`; MV3
 * content scripts forbid 'unsafe-eval'.
 */
import path from "node:path"
import { defineConfig, type Plugin } from "vite"

/**
 * JSZip bundles the `setimmediate` polyfill, whose `setImmediate` turns a
 * non-function argument into `new Function("" + arg)`. JSZip only ever passes
 * functions, so that branch is dead, but replace it anyway so the bundle holds
 * no string-eval at all — then fail the build if any `new Function` / `eval(`
 * is left, so a dependency can't quietly reintroduce the CSP error.
 */
function noEval(): Plugin {
  return {
    name: "patreon-epub-no-eval",
    renderChunk(code) {
      const out = code.replace(
        /new Function\(\s*""\s*\+\s*([\w$]+)\s*\)/g,
        (_all, arg: string) => `(function () { throw new TypeError("setImmediate needs a function, got " + ${arg}) })`,
      )
      const left = /new Function\b|\beval\s*\(/.exec(out)
      if (left) {
        const at = out.slice(Math.max(0, left.index - 120), left.index + 60)
        throw new Error(`content.js would contain "${left[0]}", which the MV3 content-script CSP blocks:\n${at}`)
      }
      return { code: out, map: null }
    },
  }
}

export default defineConfig({
  root: __dirname,
  plugins: [noEval()],
  publicDir: path.resolve(__dirname, "public"),
  resolve: {
    alias: { "@": path.resolve(__dirname, "../../src") },
  },
  define: {
    // Some deps probe process.env.NODE_ENV; there is no `process` in a page.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "chrome110",
    // An unpacked extension doesn't need minifying, and readable output is
    // easier to debug from chrome://extensions.
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, "src/content.ts"),
      formats: ["iife"],
      name: "PatreonEpubContent",
      fileName: () => "content.js",
    },
  },
})
