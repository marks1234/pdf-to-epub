/**
 * Build for the Patreon → EPUB Chrome extension:
 *
 *   vite build -c extensions/patreon-epub/vite.config.ts
 *
 * Emits two bundles plus public/ (manifest.json):
 * - dist/app.js — the whole extension as an ES module (src/app.ts), exposed as
 *   a web-accessible resource and imported on demand;
 * - dist/content.js — the tiny bootstrap content script (src/bootstrap.ts), an
 *   IIFE (content scripts can't be ES modules) injected on every Patreon page;
 *   it imports app.js only when a collection page is seen.
 *
 * The EPUB is written by an eval-free writer (src/epub-writer.ts), so neither
 * bundle may contain `new Function` or `eval(`; MV3 forbids 'unsafe-eval'.
 */
import path from "node:path"
import { build, defineConfig, type Plugin, type UserConfig } from "vite"

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
    renderChunk(code, chunk) {
      const out = code.replace(
        /new Function\(\s*""\s*\+\s*([\w$]+)\s*\)/g,
        (_all, arg: string) => `(function () { throw new TypeError("setImmediate needs a function, got " + ${arg}) })`,
      )
      const left = /new Function\b|\beval\s*\(/.exec(out)
      if (left) {
        const at = out.slice(Math.max(0, left.index - 120), left.index + 60)
        throw new Error(`${chunk.fileName} would contain "${left[0]}", which the MV3 CSP blocks:\n${at}`)
      }
      return { code: out, map: null }
    },
  }
}

const outDir = path.resolve(__dirname, "dist")

const shared: UserConfig = {
  root: __dirname,
  plugins: [noEval()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "../../src") },
  },
  define: {
    // Some deps probe process.env.NODE_ENV; there is no `process` in a page.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
}

/** After app.js is written, build the bootstrap into the same dist/. */
function bootstrapBuild(): Plugin {
  return {
    name: "patreon-epub-bootstrap",
    apply: "build",
    async closeBundle() {
      await build({
        ...shared,
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        build: {
          outDir,
          emptyOutDir: false,
          target: "chrome116",
          minify: true,
          sourcemap: false,
          lib: {
            entry: path.resolve(__dirname, "src/bootstrap.ts"),
            formats: ["iife"],
            name: "PatreonEpubBootstrap",
            fileName: () => "content.js",
          },
        },
      })
    },
  }
}

export default defineConfig({
  ...shared,
  plugins: [noEval(), bootstrapBuild()],
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir,
    emptyOutDir: true,
    target: "chrome116",
    // An unpacked extension doesn't need minifying, and readable output is
    // easier to debug from chrome://extensions.
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, "src/app.ts"),
      formats: ["es"],
      fileName: () => "app.js",
    },
  },
})
