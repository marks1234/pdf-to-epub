# pdf-to-epub

A React PWA that **merges multiple PDF files** and **converts them to an EPUB** —
entirely in the browser. No uploads, no backend; your files never leave your
device.

## Conversion pipeline

Queue PDFs (one chapter per file, or merge them into a single PDF first), then
convert. Everything after the file picker runs in a **module worker**
([src/workers/convert.worker.ts](src/workers/convert.worker.ts)): text
extraction, layout reconstruction, cleanup, EPUB assembly and zip compression.
The main thread stays interactive, so a long batch shows live progress
(current chapter, file name, a progress bar) and can be **cancelled** part-way.

Failures are contained per file: a corrupt, encrypted or non-PDF input is
recorded as a failure and the rest of the batch still produces a book. When the
run ends, a summary names the files that failed and the chapters that came out
empty (usually scanned pages with no text layer).

Text is rebuilt from pdf.js glyph geometry rather than taken as a flat string
([src/lib/reconstruct.ts](src/lib/reconstruct.ts)), which is what lets bullet
lists, stat blocks and wrapped prose be told apart.

## Text cleanup

[src/lib/cleanup.ts](src/lib/cleanup.ts) is applied at the point in the pipeline
where each pass does the least damage:

- **Ligatures and invisible characters** — `ﬁ`/`ﬂ`/… expand, soft hyphens and
  zero-width characters are dropped, non-breaking spaces become plain ones.
  Deliberately not a blanket NFKC, which would flatten superscripts and
  full-width characters that carry meaning in stat sheets.
- **Running headers and footers** — repeated page furniture (running heads, page
  numbers) is detected across pages and stripped.
- **De-hyphenation** — Calibre-style, run last and over the whole book, using the
  document itself as a dictionary so real hyphenated compounds survive.
- **Scene breaks** — `* * *` / `◇◇◇` dividers become a semantic `<hr>` instead of
  a paragraph of punctuation.
- **Cross-page paragraphs** — a paragraph broken by a page boundary is rejoined.

## EPUB output

jepub emits EPUB 2 with a few spec violations, so the zip is rebuilt into an
**EPUB 3** package that is a strict superset
([src/lib/epub-normalize.ts](src/lib/epub-normalize.ts)):

- EPUB 3 `nav.xhtml` (Kobo eInk otherwise lists raw spine filenames), with the
  **NCX kept** — Kindle requires it past 20 pages — and `playOrder` renumbered
- the EPUB 2 `<guide>` kept and extended with **landmarks**, including a
  start-reading reference Kindle honors
- a cover image, plus `dc:language`, description, and **series** metadata
  (Calibre `series`/`series_index` and the EPUB 3 `belongs-to-collection` form)
- an optional **Kindle series title** — the series name and a zero-padded index
  lead `dc:title` so sideloaded volumes sort together; the download filename
  keeps the plain title
- one stylesheet at `OEBPS/style.css`, linked from every page

Each output's chapters are stored alongside it, so an EPUB can be re-styled
later without re-parsing the PDFs. A re-style reuses the book's `dc:identifier`,
so the device replaces the old file instead of shelving a second copy.

## Styling

[src/lib/styles.ts](src/lib/styles.ts) compiles one editable `StyleConfig` into
the book stylesheet plus the colorizers used while rendering chapters. The
in-app **Style editor** covers:

- **Rarity tiers** — bracketed words (`[Legendary]`) and bare `<word>-grade`
  forms, each with a color and an optional Kindle-safe glow
- **Keyword groups** — build/status words matched bracketed or bare; groups can
  be added and removed
- **Percentages** — a low→mid→high color ramp, with an option to treat the
  second of a close pair as the maximum
- **Stat-sheet panel** — background, border, rounded corners

An **e-ink safety audit** flags colors that would vanish on a device: every
color is checked against a white page *and* the black page Kindle night mode
forces, adjacent tiers that collapse to the same grey on monochrome e-ink are
listed, and a one-click fix nudges failing colors into range or switches the
panel to border-only. No `linear-gradient` is ever written into the book CSS —
one anywhere disables Kindle Enhanced Typesetting for the whole title.

Configs can be saved as named **profiles** and imported/exported as JSON.
A separate **Colors** button in the header edits the default style new
conversions start from. The live preview renders the real book's own text when
one is open, and a canned sample otherwise.

## Reading in the app

Any EPUB with stored chapters gets a **Preview** button: a reader dialog with a
chapter sidebar, prev/next navigation, and the chapter rendered through the same
code path the EPUB uses, in that book's own saved style. A light/dark page
toggle inside the dialog shows how it reads in both modes.

## Queue

- Drag and drop PDFs; duplicates already queued are skipped and reported
- Click, ⇧-click and ⌃/⌘-click to select; drag any selected row to move the
  whole selection as a block
- Auto-order by chapter number, or bulk-rename selected rows with a pattern
- Per-file chapter titles, editable inline
- Numeric sequence detection flags missing and duplicate chapter numbers, inline
  and in a banner
- The queue (files, order, titles and book details) is persisted, so a reload
  does not lose the setup

## Storage

Everything is local to the browser and device — nothing syncs.

- **IndexedDB** holds generated files, chapter text (in its own store, so listing
  the history never deserializes every book), style profiles, and the queue
  snapshot. The last 50 outputs are kept, pruned oldest-first and capped by both
  a hard byte budget and a fraction of the reported quota.
- **localStorage** holds remembered titles/authors, the default style and the
  theme choice.
- Persistent storage is requested on load to reduce eviction risk, but clearing
  browser data removes everything.

## Interface

Light/dark/system theme (applied before first paint, so there is no flash), a
single-pane tab switcher below the `lg` breakpoint for phones, keyboard-operable
selection and drag, and screen-reader announcements for selection changes and
long-running conversions.

## Tech stack

| Concern              | Library                          |
| -------------------- | -------------------------------- |
| Framework            | React 18 + TypeScript + Vite     |
| UI / styling         | Tailwind CSS v4 + shadcn/ui      |
| PWA                  | `vite-plugin-pwa`                |
| Merge PDFs           | `pdf-lib`                        |
| Extract PDF text     | `pdfjs-dist`                     |
| Generate EPUB        | `jepub` + `jszip`                |
| Drag & drop          | `@dnd-kit`, `react-dropzone`     |
| Icons                | `lucide-react`                   |
| Tests                | `vitest`                         |

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
npm run lint     # run eslint
npm test         # run the unit tests
```

> The production build uses **terser** with reserved identifiers, not esbuild's
> minifier — see the comment in [vite.config.ts](vite.config.ts). Removing that
> breaks EPUB generation in production builds only.

## Deploy (GitHub Pages)

The app is static — it builds to `dist/` and needs no server. A workflow at
[.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds and publishes
it on every push to `main`.

One-time setup:

```bash
# create the repo on GitHub and push (replace <user>)
git remote add origin https://github.com/<user>/pdf-to-epub.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build and deployment → Source = GitHub
Actions**. The next push deploys to `https://<user>.github.io/pdf-to-epub/`,
where it's installable as a PWA and works offline.

> The production base path is `/pdf-to-epub/` (set in
> [vite.config.ts](vite.config.ts)). If you rename the repo or use a custom
> domain, update `BASE` there.

## Project structure

```
src/
  components/       app dialogs & queue rows (ui/ = shadcn/ui)
  hooks/            converter, output history, queue persistence, theme
  lib/
    merge-pdf.ts    merge PDFs with pdf-lib
    pdf-to-epub.ts  extract text (pdf.js) + build EPUB (jepub)
    reconstruct.ts  glyph geometry → blocks → chapter HTML
    cleanup.ts      ligatures, de-hyphenation, header/footer stripping
    epub-normalize.ts  rewrite jepub's output as valid EPUB 3
    styles.ts       StyleConfig → stylesheet + colorizers
    storage.ts      IndexedDB history, chapters, profiles, queue
  workers/
    convert.worker.ts  the whole conversion pipeline, off the main thread
  App.tsx           main UI
  main.tsx          entry point
  index.css         Tailwind v4 + shadcn theme tokens
```

Most of `lib/` is pure and dependency-free, and covered by unit tests
(`npm test`) — including a fixture-driven regression suite for the stat-sheet
rendering.

## Adding shadcn/ui components

This repo is configured for the shadcn MCP server (`.mcp.json`) so components can
be added conversationally. You can also use the CLI:

```bash
npx shadcn@latest add <component>
```

## Notes & roadmap

- **EPUB conversion is text-based.** Scanned/image-only PDFs have no text layer,
  so they produce empty chapters — OCR (e.g. Tesseract.js) would be a future
  addition.
- Layout, images, and fonts from the PDF are not carried into the EPUB; the
  conversion focuses on readable text.
- PWA icons currently use an SVG. For best install support on all platforms,
  generate raster icons with `npm run generate-pwa-assets` from a source image.
