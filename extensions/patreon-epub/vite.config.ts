/**
 * Build for the Patreon → EPUB Chrome extension.
 *
 * Content scripts can't be ES modules and a lib build can only emit IIFE for a
 * single entry, so this config builds one entry per run, picked by `--mode`:
 *
 *   vite build -c extensions/patreon-epub/vite.config.ts --mode content
 *   vite build -c extensions/patreon-epub/vite.config.ts --mode sandbox
 *
 * The `content` run empties dist/ and copies public/ (manifest, sandbox.html);
 * the `sandbox` run adds sandbox.js alongside. `npm run build:extension` runs both.
 */
import path from "node:path"
import { defineConfig } from "vite"

const ENTRIES = {
  content: "src/content.ts",
  sandbox: "src/sandbox.ts",
} as const

export default defineConfig(({ mode }) => {
  const entry = mode in ENTRIES ? (mode as keyof typeof ENTRIES) : "content"
  const first = entry === "content"
  return {
    root: __dirname,
    publicDir: first ? path.resolve(__dirname, "public") : false,
    resolve: {
      alias: { "@": path.resolve(__dirname, "../../src") },
    },
    define: {
      // Some deps probe process.env.NODE_ENV; there is no `process` in a page.
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      outDir: path.resolve(__dirname, "dist"),
      emptyOutDir: first,
      target: "chrome110",
      // jepub's EJS templates are compiled with `new Function` from source text
      // that names helpers literally; minifying renames them and breaks it (see
      // the main vite.config.ts). An unpacked extension doesn't need minifying.
      minify: false,
      sourcemap: false,
      copyPublicDir: first,
      lib: {
        entry: path.resolve(__dirname, ENTRIES[entry]),
        formats: ["iife"],
        name: entry === "content" ? "PatreonEpubContent" : "PatreonEpubSandbox",
        fileName: () => `${entry}.js`,
      },
    },
  }
})
