import * as pdfjsLib from "pdfjs-dist"
import type { TextItem } from "pdfjs-dist/types/src/display/api"
// Vite resolves this to a hashed URL for the pdf.js worker bundle.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import jEpub from "jepub"

import { normalizeOcf } from "@/lib/epub-normalize"
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
  /**
   * BCP-47 language tag, default `"en"`. Drives `dc:language`, which is what
   * Kindle uses to pick its font stack.
   */
  language?: string
  /** Series name — written as calibre + EPUB 3 collection metadata. */
  series?: string
  /** 1-based position within `series`. */
  seriesIndex?: number
  /**
   * Cover image. A book without an embedded cover shows up on Kindle as "Docs"
   * with a raw filename. Aim for a JPEG, sRGB, no alpha, ≥1200px on the long edge.
   */
  cover?: Blob
  /**
   * Stable `dc:identifier`. Pass the same value on every re-style so devices
   * treat the result as a new version of one book rather than a new book.
   */
  identifier?: string
}

/**
 * The UI languages jepub ships. `init()` throws on anything else, so an
 * unsupported tag falls back to English for jepub's own strings — `dc:language`
 * still carries the requested tag (set during normalization).
 */
const JEPUB_UI_LANGUAGES = new Set([
  "en", "vi", "hi", "fr", "de", "es", "it", "pt", "ru", "ja", "ko",
  "zh", "ar", "nl", "sv", "da", "no", "fi", "pl", "cs", "tr",
])

function jepubUiLanguage(language: string): string {
  const base = language.split("-")[0].toLowerCase()
  return JEPUB_UI_LANGUAGES.has(base) ? base : "en"
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
  const language = meta.language || "en"
  const epub = new jEpub()
  epub.init({
    i18n: jepubUiLanguage(language),
    title: meta.title,
    author: meta.author,
    publisher: meta.publisher || "pdf-to-epub",
    description: meta.description || "",
  })

  // A stable identifier keeps a re-styled book the *same* book to a device.
  if (meta.identifier) epub.uuid(meta.identifier)
  epub.date(new Date())

  if (meta.cover) {
    // Hand jepub an ArrayBuffer: it then sniffs the format from the magic bytes
    // instead of trusting `blob.type`, which is empty for some file pickers.
    const bytes = await meta.cover.arrayBuffer()
    try {
      epub.cover(bytes)
    } catch {
      // jepub throws bare strings; surface something actionable instead. A
      // silently dropped cover is exactly what makes Kindle show a book as
      // "Docs" with a raw filename.
      throw new Error(
        "The cover image format isn't supported. Use a JPEG or PNG (JPEG, sRGB, no transparency works best on Kindle).",
      )
    }
  }

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

  const raw = await epub.generate("blob")
  return normalizeOcf(raw, {
    css: styler.css,
    language,
    series: meta.series,
    seriesIndex: meta.seriesIndex,
  })
}

/**
 * Convert PDF files into a single EPUB — one chapter per file. Returns both the
 * Blob and the reconstructed chapters so the caller can persist the chapters and
 * re-style the EPUB later without re-parsing the PDFs.
 *
 * `config` overrides the built-in look, letting the caller convert straight into
 * their saved default style.
 */
export async function pdfToEpub(
  files: File[],
  meta: EpubMetadata,
  config?: StyleConfig,
): Promise<{ blob: Blob; chapters: Chapter[] }> {
  const chapters = await pdfToChapters(files)
  const blob = await chaptersToEpub(
    chapters,
    meta,
    config ? createStyler(config) : DEFAULT_STYLER,
  )
  return { blob, chapters }
}

/**
 * Re-render stored chapters into a new EPUB Blob using a custom style config.
 *
 * Pass `identifier` (the output record's id) so every re-style of the same book
 * keeps one `dc:identifier` — readers then replace the book instead of filing a
 * duplicate. It overrides `meta.identifier` when both are given.
 */
export async function restyleEpub(
  chapters: Chapter[],
  meta: EpubMetadata,
  config: StyleConfig,
  identifier?: string,
): Promise<Blob> {
  return chaptersToEpub(
    chapters,
    identifier ? { ...meta, identifier } : meta,
    createStyler(config),
  )
}
