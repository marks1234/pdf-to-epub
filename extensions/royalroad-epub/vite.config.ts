/**
 * Build for the Royal Road → EPUB Chrome extension:
 *
 *   npm run build:extension:royalroad
 *
 * Emits dist/content.js and dist/background.js (IIFEs) plus public/manifest.json.
 * Like the Patreon extension, the bundles must hold no `new Function` / `eval(`
 * (MV3 forbids 'unsafe-eval'), so the EPUB comes from the eval-free writer.
 */
import path from "node:path"
import { build, defineConfig, type Plugin, type UserConfig } from "vite"

function noEval(): Plugin {
  return {
    name: "royalroad-epub-no-eval",
    renderChunk(code, chunk) {
      const out = code.replace(
        /new Function\(\s*""\s*\+\s*([\w$]+)\s*\)/g,
        (_all, arg: string) => `(function () { throw new TypeError("setImmediate needs a function, got " + ${arg}) })`,
      )
      const left = /new Function\b|\beval\s*\(/.exec(out)
      if (left) throw new Error(`${chunk.fileName} would contain "${left[0]}", which the MV3 CSP blocks`)
      return { code: out, map: null }
    },
  }
}

const outDir = path.resolve(__dirname, "dist")

const shared: UserConfig = {
  root: __dirname,
  plugins: [noEval()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
}

function backgroundBuild(): Plugin {
  return {
    name: "royalroad-epub-background",
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
          minify: false,
          lib: { entry: path.resolve(__dirname, "src/background.ts"), formats: ["iife"], name: "RoyalRoadEpubBg", fileName: () => "background.js" },
        },
      })
    },
  }
}

export default defineConfig({
  ...shared,
  plugins: [noEval(), backgroundBuild()],
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir,
    emptyOutDir: true,
    target: "chrome116",
    minify: false,
    sourcemap: false,
    lib: { entry: path.resolve(__dirname, "src/content.ts"), formats: ["iife"], name: "RoyalRoadEpub", fileName: () => "content.js" },
  },
})
