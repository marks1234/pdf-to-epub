import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

// Served from https://<user>.github.io/pdf-to-epub/ in production.
const BASE = "/pdf-to-epub/"

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const base = command === "build" ? BASE : "/"
  // Honor an externally assigned port (e.g. from the Claude Code preview harness).
  const port = process.env.PORT ? Number(process.env.PORT) : undefined
  return {
    base,
    server: { port },
    preview: { port },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg"],
        manifest: {
          name: "PDF Merge & EPUB",
          short_name: "PDF→EPUB",
          description:
            "Merge PDF files and convert them to EPUB — entirely in your browser.",
          theme_color: "#0a0a0a",
          background_color: "#ffffff",
          display: "standalone",
          start_url: base,
          scope: base,
          icons: [
            { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          ],
        },
        workbox: {
          // The pdf.js worker bundle is large; allow it to be precached.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      // jepub renders its templates through EJS with `client: true`. EJS embeds
      // its escape helper into a runtime `new Function` via `escapeXML.toString()`,
      // which appends the helper source as a STRING LITERAL with hardcoded names
      // (`_MATCH_HTML`, `encode_char`, `_ENCODE_HTML_RULES`). esbuild's default
      // minifier renames those identifiers in the function body but not in the
      // string literal, so the generated function references a mangled name that
      // doesn't exist → "a is not defined" at conversion time (prod only; dev is
      // unminified). Use terser and reserve those names so body and literal stay
      // in sync. Do NOT remove this without re-testing PDF→EPUB on a prod build.
      minify: "terser",
      terserOptions: {
        mangle: {
          reserved: ["_MATCH_HTML", "encode_char", "_ENCODE_HTML_RULES"],
        },
      },
    },
  }
})
