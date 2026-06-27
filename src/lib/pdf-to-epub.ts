import * as pdfjsLib from "pdfjs-dist"
import type { TextItem } from "pdfjs-dist/types/src/display/api"
// Vite resolves this to a hashed URL for the pdf.js worker bundle.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import jEpub from "jepub"
import JSZip from "jszip"

import { extractNumber } from "@/lib/sequence"
import {
  DEFAULT_STYLER,
  blocksToHtml,
  reconstructBlocks,
  type Block,
} from "@/lib/reconstruct"
import { createStyler, type StyleConfig, type Styler } from "@/lib/styles"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// The reconstruction/render logic lives in reconstruct.ts; re-exported for tests.
export type { Block, ReconstructedLine } from "@/lib/reconstruct"
export { assembleBlocks, blocksToHtml } from "@/lib/reconstruct"

export interface EpubMetadata {
  title: string
  author: string
  publisher?: string
  description?: string
}

/** One chapter's reconstructed content; stored so an EPUB can be re-styled later. */
export interface Chapter {
  title: string
  blocks: Block[]
}

function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem).str === "string"
}

/** Derive a chapter title from a file name, e.g. "Chapter 22 (2,509 words).pdf" → "Chapter 22". */
function chapterTitle(filename: string): string {
  const { num, label } = extractNumber(filename)
  if (label && num !== null) return `${label} ${num}`

  const base = filename.replace(/\.[^.]+$/, "")
  const cleaned = base
    .replace(/\s*\([^)]*\)\s*/g, " ") // drop "(2,509 words)"-style notes
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || base
}

/**
 * Renumber every NCX `playOrder` sequentially (1, 2, 3, …). jepub can emit
 * duplicate values, which EPUB 2 forbids unless they point to the same target
 * (epubcheck RSC-005). Sequential unique values are always valid.
 */
function fixNcxPlayOrder(xml: string): string {
  let n = 0
  return xml.replace(/playOrder="\d+"/g, () => `playOrder="${++n}"`)
}

// Where the stylesheet lives in the EPUB. Pages sit in OEBPS/ and link it by
// relative name; the OPF (book.opf, at the zip root) references it with the
// OEBPS/ prefix. jepub ships no stylesheet, so we add and wire up our own.
const STYLESHEET_PATH = "OEBPS/style.css"
const STYLESHEET_HREF = "style.css"
const STYLESHEET_MANIFEST_ITEM = `<item id="rarity-css" href="${STYLESHEET_PATH}" media-type="text/css" />`
const STYLESHEET_LINK = `<link rel="stylesheet" type="text/css" href="${STYLESHEET_HREF}" />`

/** Register the stylesheet in the OPF manifest (epubcheck requires every file declared). */
function addCssToManifest(opf: string): string {
  return opf.replace("</manifest>", `\t\t${STYLESHEET_MANIFEST_ITEM}\n\t</manifest>`)
}

/** Link the stylesheet from a page's `<head>` so its rules apply. */
function linkCss(html: string): string {
  return html.replace("</head>", `\t${STYLESHEET_LINK}\n</head>`)
}

/**
 * Rebuild an EPUB zip so the `mimetype` entry is first and STORED (uncompressed),
 * as required by the OCF spec, and fix the NCX play order. jepub/JSZip otherwise
 * trip epubcheck (PKG-007 / RSC-005) and stricter readers like Send-to-Kindle.
 *
 * Also injects the stylesheet `css`: writes OEBPS/style.css, declares it in the
 * OPF manifest, and links it from every XHTML page.
 */
async function normalizeOcf(epubBlob: Blob, css: string): Promise<Blob> {
  const src = await JSZip.loadAsync(epubBlob)
  const out = new JSZip()

  // mimetype must be the very first entry and uncompressed.
  out.file("mimetype", "application/epub+zip", { compression: "STORE" })

  for (const entry of Object.values(src.files)) {
    if (entry.dir || entry.name === "mimetype") continue
    const name = entry.name.toLowerCase()
    if (name.endsWith(".ncx")) {
      const xml = await entry.async("string")
      out.file(entry.name, fixNcxPlayOrder(xml), { compression: "DEFLATE" })
    } else if (name.endsWith(".opf")) {
      const opf = await entry.async("string")
      out.file(entry.name, addCssToManifest(opf), { compression: "DEFLATE" })
    } else if (name.endsWith(".html") || name.endsWith(".xhtml")) {
      const html = await entry.async("string")
      out.file(entry.name, linkCss(html), { compression: "DEFLATE" })
    } else {
      const data = await entry.async("uint8array")
      out.file(entry.name, data, { compression: "DEFLATE" })
    }
  }

  out.file(STYLESHEET_PATH, css, { compression: "DEFLATE" })

  return out.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  })
}

/** Reconstruct one PDF file into a titled chapter of blocks. */
async function pdfFileToChapter(file: File): Promise<Chapter> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise

  const blocks: Block[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items.filter(isTextItem)
    blocks.push(...reconstructBlocks(items))
  }
  return { title: chapterTitle(file.name), blocks }
}

/** Reconstruct PDF files into chapters (one per file), preserving queue order. */
export async function pdfToChapters(files: File[]): Promise<Chapter[]> {
  if (files.length === 0) throw new Error("Add at least one PDF to convert.")
  const chapters: Chapter[] = []
  for (const file of files) chapters.push(await pdfFileToChapter(file))
  return chapters
}

/**
 * Build a spec-compliant EPUB from already-reconstructed chapters, rendering and
 * styling them with `styler` (defaults to the built-in look). This is the shared
 * path for first conversion and for re-styling from the Style Editor.
 */
export async function chaptersToEpub(
  chapters: Chapter[],
  meta: EpubMetadata,
  styler: Styler = DEFAULT_STYLER,
): Promise<Blob> {
  const epub = new jEpub()
  epub.init({
    i18n: "en",
    title: meta.title,
    author: meta.author,
    publisher: meta.publisher || "pdf-to-epub",
    description: meta.description || "",
  })

  for (const ch of chapters) {
    const html =
      ch.blocks.length === 0
        ? "<p><em>(no extractable text — this PDF may be scanned images)</em></p>"
        : blocksToHtml(ch.blocks, styler)
    epub.add(ch.title, html)
  }

  // jepub references a notes page in its manifest; create it so the EPUB
  // doesn't point at a missing file (epubcheck RSC-001).
  epub.notes(`Generated by pdf-to-epub from ${chapters.length} file(s).`)

  const raw = (await epub.generate("blob")) as Blob
  return normalizeOcf(raw, styler.css)
}

/**
 * Convert PDF files into a single EPUB — one chapter per file. Returns both the
 * Blob and the reconstructed chapters so the caller can persist the chapters and
 * re-style the EPUB later without re-parsing the PDFs.
 */
export async function pdfToEpub(
  files: File[],
  meta: EpubMetadata,
): Promise<{ blob: Blob; chapters: Chapter[] }> {
  const chapters = await pdfToChapters(files)
  const blob = await chaptersToEpub(chapters, meta)
  return { blob, chapters }
}

/** Re-render stored chapters into a new EPUB Blob using a custom style config. */
export async function restyleEpub(
  chapters: Chapter[],
  meta: EpubMetadata,
  config: StyleConfig,
): Promise<Blob> {
  return chaptersToEpub(chapters, meta, createStyler(config))
}
