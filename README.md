# pdf-to-epub

A React PWA that **merges multiple PDF files** and **converts the result to an
EPUB** — entirely in the browser. No uploads, no backend; your files never leave
your device.

## Features

- 📎 Merge any number of PDFs, reorder them before exporting
- 📖 Convert the merged PDF to EPUB (text-based, one chapter per page)
- 💾 Download the merged PDF or the generated EPUB
- 📱 Installable PWA with offline support

## Tech stack

| Concern              | Library                          |
| -------------------- | -------------------------------- |
| Framework            | React 18 + TypeScript + Vite     |
| UI / styling         | Tailwind CSS v4 + shadcn/ui      |
| PWA                  | `vite-plugin-pwa`                |
| Merge PDFs           | `pdf-lib`                        |
| Extract PDF text     | `pdfjs-dist`                     |
| Generate EPUB        | `jepub` + `jszip`                |
| File upload UX       | `react-dropzone`, `lucide-react` |

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
npm run lint     # run eslint
```

## Project structure

```
src/
  components/ui/   shadcn/ui components
  lib/
    merge-pdf.ts   merge PDFs with pdf-lib
    pdf-to-epub.ts extract text (pdf.js) + build EPUB (jepub)
    download.ts    trigger browser downloads
    utils.ts       cn() class helper
  App.tsx          main UI
  main.tsx         entry point
  index.css        Tailwind v4 + shadcn theme tokens
```

## Adding shadcn/ui components

This repo is configured for the shadcn MCP server (`.mcp.json`) so components can
be added conversationally. You can also use the CLI:

```bash
npx shadcn@latest add <component>
```

## Notes & roadmap

- **EPUB conversion is text-based.** Scanned/image-only PDFs have no text layer,
  so they produce empty pages — OCR (e.g. Tesseract.js) would be a future
  addition.
- Layout, images, and fonts from the PDF are not yet carried into the EPUB; the
  current conversion focuses on readable text. Richer conversion is on the
  roadmap.
- PWA icons currently use an SVG. For best install support on all platforms,
  generate raster icons with `npm run generate-pwa-assets` from a source image.
