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
  return {
    base,
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
  }
})
