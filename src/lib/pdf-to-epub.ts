import * as pdfjsLib from "pdfjs-dist"
import type { TextItem } from "pdfjs-dist/types/src/display/api"
// Vite resolves this to a hashed URL for the pdf.js worker bundle.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { chapterTitle } from "@/lib/titles"
import {
  DEFAULT_STYLER,
  reconstructChapterBlocks,
  type Glyph,
} from "@/lib/reconstruct"
import { dehyphenateAll, normalizeCharacters } from "@/lib/cleanup"
import { createStyler, type StyleConfig } from "@/lib/styles"
import { chaptersToEpub, type Chapter, type EpubMetadata } from "@/lib/epub-book"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// The filename→title derivation lives in `titles.ts` (a dependency-free module
// the UI can import without pulling this whole pipeline into the main bundle),
// but it is part of this module's public surface.
export { chapterTitle } from "@/lib/titles"

// EPUB assembly lives in `epub-book.ts` (no pdf.js), so other front-ends — the
// Patreon browser extension — can build books without bundling pdf.js. It stays
// part of this module's public surface.
export { chaptersToEpub, type Chapter, type EpubMetadata } from "@/lib/epub-book"

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
  /**
   * Chapter titles, index-aligned with `files`. An entry that is undefined (or
   * blank) falls back to {@link chapterTitle} on that file's name, so a partly
   * filled array is fine — pass only the ones the user renamed.
   */
  titles?: (string | undefined)[]
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

/**
 * Reconstruct one PDF file into a titled chapter of blocks, plus its page count.
 *
 * `title` overrides the name-derived chapter title when it holds anything but
 * whitespace.
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
  title?: string,
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
      chapter: {
        title: title?.trim() || chapterTitle(file.name),
        blocks: reconstructChapterBlocks(pages),
      },
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
 *
 * `options.titles` overrides the name-derived chapter titles, index-aligned
 * with `files`.
 */
export async function pdfToChapters(
  files: File[],
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (files.length === 0) throw new Error("Add at least one PDF to convert.")
  const { onProgress, signal, titles } = options
  const chapters: Chapter[] = []
  const failures: FileFailure[] = []
  let pageCount = 0

  onProgress?.(0, files.length, files[0].name)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    throwIfAborted(signal)
    try {
      const result = await pdfFileToChapter(file, signal, titles?.[i])
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
