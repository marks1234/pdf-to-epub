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
  reconstructChapterBlocks,
  type Block,
  type Glyph,
} from "@/lib/reconstruct"
import { dehyphenateAll, normalizeCharacters } from "@/lib/cleanup"
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

/** A file that could not be read at all (corrupt, encrypted, not a PDF). */
export interface FileFailure {
  name: string
  error: string
}

/** Optional controls for a batch extraction. */
export interface ExtractOptions {
  /**
   * Called once with `done = 0` before the first file, then after each file
   * finishes (whether it produced a chapter or failed). `currentName` is the
   * file just finished — or, on the initial call, the one about to start.
   */
  onProgress?: (done: number, total: number, currentName: string) => void
  /** Aborts between files and between pages, rejecting with an `AbortError`. */
  signal?: AbortSignal
}

/** Everything one batch extraction learned, including what went wrong. */
export interface ExtractResult {
  /** One chapter per successfully read file, in queue order. */
  chapters: Chapter[]
  /** Total pages across the files that could be opened. */
  pageCount: number
  /** Files skipped because they could not be read; they produce no chapter. */
  failures: FileFailure[]
  /** Titles of chapters that yielded no text (typically scanned-image PDFs). */
  emptyChapters: string[]
}

/** What a full conversion returns: the EPUB plus everything extraction learned. */
export interface ConvertResult extends ExtractResult {
  blob: Blob
}

function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem).str === "string"
}

function abortError(): DOMException {
  return new DOMException("Extraction aborted.", "AbortError")
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === "string" ? e : "Unknown error"
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

/**
 * Reconstruct one PDF file into a titled chapter of blocks, plus its page count.
 *
 * Every page's glyphs are collected first (normalized, and reduced to the four
 * fields reconstruction needs, so the pdf.js objects can be released) and the
 * whole file is reconstructed at once — cross-page paragraph healing and running
 * header/footer detection both need to see all the pages together.
 *
 * The document is always destroyed and each page released, even on failure:
 * pdf.js keeps a worker-side copy of every page it has parsed, and a 90-file
 * batch that never destroys anything will exhaust memory long before the end.
 */
async function pdfFileToChapter(
  file: File,
  signal?: AbortSignal,
): Promise<{ chapter: Chapter; pageCount: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  try {
    const pages: Glyph[][] = []
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      throwIfAborted(signal)
      const page = await pdf.getPage(pageNum)
      try {
        const content = await page.getTextContent()
        pages.push(
          content.items.filter(isTextItem).map((it) => ({
            str: normalizeCharacters(it.str),
            width: it.width,
            height: it.height,
            transform: it.transform,
          })),
        )
      } finally {
        page.cleanup()
      }
    }
    return {
      chapter: { title: chapterTitle(file.name), blocks: reconstructChapterBlocks(pages) },
      pageCount: pdf.numPages,
    }
  } finally {
    await pdf.destroy()
  }
}

/**
 * De-hyphenate every chapter against the whole book's vocabulary, in place.
 * Runs once, after extraction, because the dictionary is the document itself:
 * a word broken across a page break in chapter 3 is often only corroborated by
 * an occurrence in chapter 40.
 */
function dehyphenateBook(chapters: Chapter[]): void {
  const blocks = chapters.flatMap((c) => c.blocks)
  const texts = dehyphenateAll(blocks.map((b) => b.text))
  blocks.forEach((b, i) => {
    b.text = texts[i]
  })
}

/**
 * Reconstruct PDF files into chapters (one per file), preserving queue order.
 *
 * A file that cannot be read — corrupt, encrypted, not actually a PDF — is
 * recorded in `failures` and skipped; it never aborts the batch and never
 * produces a placeholder chapter. A file that reads but yields no text still
 * becomes a chapter (so the queue and the book stay aligned) and its title is
 * listed in `emptyChapters`.
 */
export async function pdfToChapters(
  files: File[],
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (files.length === 0) throw new Error("Add at least one PDF to convert.")
  const { onProgress, signal } = options
  const chapters: Chapter[] = []
  const failures: FileFailure[] = []
  let pageCount = 0

  onProgress?.(0, files.length, files[0].name)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    throwIfAborted(signal)
    try {
      const result = await pdfFileToChapter(file, signal)
      chapters.push(result.chapter)
      pageCount += result.pageCount
    } catch (e) {
      // An abort is a cancellation of the whole batch, not a bad file.
      if (signal?.aborted) throw abortError()
      failures.push({ name: file.name, error: errorMessage(e) })
    }
    onProgress?.(i + 1, files.length, file.name)
  }

  dehyphenateBook(chapters)

  return {
    chapters,
    pageCount,
    failures,
    emptyChapters: chapters.filter((c) => c.blocks.length === 0).map((c) => c.title),
  }
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
 * Convert PDF files into a single EPUB — one chapter per file. Returns the Blob
 * alongside the full {@link ExtractResult}, so the caller can persist the
 * chapters (and re-style later without re-parsing), show the page count without
 * a second parse, and report which files were skipped.
 *
 * `config` overrides the built-in look, letting the caller convert straight into
 * their saved default style. `options` threads progress reporting and
 * cancellation into the extraction.
 */
export async function pdfToEpub(
  files: File[],
  meta: EpubMetadata,
  config?: StyleConfig,
  options?: ExtractOptions,
): Promise<ConvertResult> {
  const extracted = await pdfToChapters(files, options)
  if (extracted.chapters.length === 0) {
    const why = extracted.failures.map((f) => `${f.name}: ${f.error}`).join("; ")
    throw new Error(`None of the PDFs could be read.${why ? ` (${why})` : ""}`)
  }
  const blob = await chaptersToEpub(
    extracted.chapters,
    meta,
    config ? createStyler(config) : DEFAULT_STYLER,
  )
  return { ...extracted, blob }
}

/** Re-render stored chapters into a new EPUB Blob using a custom style config. */
export async function restyleEpub(
  chapters: Chapter[],
  meta: EpubMetadata,
  config: StyleConfig,
): Promise<Blob> {
  return chaptersToEpub(chapters, meta, createStyler(config))
}
